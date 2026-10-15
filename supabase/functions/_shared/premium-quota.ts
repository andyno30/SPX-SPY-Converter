// Quotas are opt-in until the database migration and deployment are approved.
// Only verified user IDs reach the service-role RPC; callers cannot pick limits.
export type PremiumQuotaResource = 'pro-prices' | 'premium-options';
export type QuotaDecision = { allowed: boolean; retryAfterSeconds: number };

// Deliberately no instance or TTL cache: a running handler checks the committed
// runtime control on every authorized quota attempt. Unknown control disables
// only quota enforcement; the enclosing handler still verifies JWT + membership.
export function createRuntimeQuotaConsumer(deps: {
  readControl: () => Promise<unknown>;
  consume: (verifiedUserId: string) => Promise<unknown>;
}): (verifiedUserId: string) => Promise<QuotaDecision> {
  async function enabled(): Promise<boolean> {
    try {
      const control = await deps.readControl();
      if (!control || typeof control !== 'object' || Array.isArray(control) ||
          typeof (control as Record<string, unknown>).enabled !== 'boolean') {
        throw new Error('Unverified quota control');
      }
      return (control as { enabled: boolean }).enabled;
    } catch {
      console.error('premium_api_quota_control_unverified');
      return false;
    }
  }
  const bypass = (): QuotaDecision => ({ allowed: true, retryAfterSeconds: 0 });
  return async verifiedUserId => {
    if (!await enabled()) return bypass();
    try {
      // The SQL RPC independently locks/rechecks control before any admission.
      const decision = parseQuotaDecision(await deps.consume(verifiedUserId));
      // An emergency disable can also recover a denial computed just before its
      // commit. Already transmitted/in-flight responses cannot be recalled.
      if (!decision.allowed && !await enabled()) return bypass();
      return decision;
    } catch {
      // Never use the earlier enabled read to turn a failed limiter into a 503
      // after emergency disable, or while current control cannot be verified.
      if (!await enabled()) return bypass();
      throw new Error('Premium quota failed while runtime control is enabled');
    }
  };
}

export function parseQuotaDecision(value: unknown): QuotaDecision {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid premium quota response');
  }
  const result = value as Record<string, unknown>;
  const retry = result.retry_after_seconds;
  if (typeof result.allowed !== 'boolean' || typeof retry !== 'number' ||
      !Number.isInteger(retry) || retry < 0 || retry > 3600 ||
      (result.allowed ? retry !== 0 : retry < 1)) {
    throw new Error('Invalid premium quota response');
  }
  return { allowed: result.allowed, retryAfterSeconds: retry };
}

export function quotaErrorResponse(
  headers: Record<string, string>,
  retryAfterSeconds: number,
  unavailable = false,
): Response {
  const message = unavailable
    ? 'Premium access is temporarily unavailable. Please try again shortly.'
    : 'Too many premium requests. Please wait before trying again.';
  return new Response(JSON.stringify({
    message,
    error: message,
    code: unavailable ? 'QUOTA_UNAVAILABLE' : 'RATE_LIMITED',
    retryAfterSeconds,
  }), {
    status: unavailable ? 503 : 429,
    headers: {
      ...headers,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'Vary': 'Authorization',
      'Retry-After': String(retryAfterSeconds),
      'Access-Control-Expose-Headers': 'Retry-After',
    },
  });
}

export async function enforcePremiumQuota(
  consume: () => Promise<QuotaDecision>,
  headers: Record<string, string>,
): Promise<Response | null> {
  try {
    const decision = await consume();
    return decision.allowed ? null : quotaErrorResponse(headers, decision.retryAfterSeconds);
  } catch {
    // Do not log credentials, user IDs, or database error details.
    console.error('premium_api_quota_unavailable');
    return quotaErrorResponse(headers, 5, true);
  }
}
