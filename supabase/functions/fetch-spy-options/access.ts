import { enforcePremiumQuota, type QuotaDecision } from '../_shared/premium-quota.ts';

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'private, no-store',
  'Vary': 'Authorization',
};

export function createOptionsAccessGuard(deps: {
  userId: (token: string) => Promise<string | null>;
  subscribed: (verifiedUserId: string) => Promise<boolean>;
  consumeQuota?: (verifiedUserId: string) => Promise<QuotaDecision>;
}) {
  // Called only after the handler's GET/method and ticker validation. Public SPY
  // never checks a session or spends a premium quota, even with a bad bearer.
  return async (req: Request, ticker: string): Promise<Response | null> => {
    if (ticker === 'SPY') return null;
    const token = req.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
    const userId = token ? await deps.userId(token) : null;
    if (!userId) return new Response(JSON.stringify({
      error: 'Sign in to access this options ticker.', code: 'AUTH_REQUIRED',
    }), { status: 401, headers: HEADERS });
    if (await deps.subscribed(userId) !== true) return new Response(JSON.stringify({
      error: 'SpyConverter Pro is required for this options ticker.', code: 'PRO_REQUIRED',
    }), { status: 403, headers: HEADERS });
    return deps.consumeQuota
      ? await enforcePremiumQuota(() => deps.consumeQuota!(userId), HEADERS)
      : null;
  };
}
