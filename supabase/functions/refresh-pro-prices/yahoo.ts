import { QUERY_SYMBOLS, type Quote } from '../get-live-price-pro/pricing.ts';

export const YAHOO_TIMEOUT_MS = 30_000;
export const YAHOO_MAX_HTTP_REQUESTS = 8;

const ALLOWED_HOSTS = new Set([
  'finance.yahoo.com',
  'query1.finance.yahoo.com',
  'query2.finance.yahoo.com',
  'fc.yahoo.com',
  'guce.yahoo.com',
  'consent.yahoo.com',
]);

export type SafeYahooRequestEvent = {
  endpoint: 'quote' | 'crumb' | 'session';
  request: number;
  durationMs: number;
  status?: number;
  outcome: 'response' | 'network_error';
};
type LogRequest = (event: SafeYahooRequestEvent) => void;

export class YahooFetchError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'YahooFetchError';
  }
}

export type YahooQuoteClient = {
  quote(
    symbols: string[],
    queryOptions: Record<string, never>,
    moduleOptions: { fetch: typeof fetch; fetchOptions: RequestInit },
  ): Promise<unknown>;
};

// A quote refresh can also need Yahoo cookie/consent/crumb requests. Count all
// those requests under the same limit and deadline, without following redirects
// inside native fetch where they would escape the counter and host checks.
export function createBoundedYahooFetch(
  fetchImpl: typeof fetch,
  signal: AbortSignal,
  maxRequests = YAHOO_MAX_HTTP_REQUESTS,
  log?: LogRequest,
): typeof fetch {
  if (!Number.isInteger(maxRequests) || maxRequests < 1) {
    throw new YahooFetchError('invalid_request_budget');
  }
  let requests = 0;
  const report = (event: SafeYahooRequestEvent) => {
    try { log?.(event); } catch { /* Logging must not change refresh behavior. */ }
  };

  return async (input, init) => {
    if (signal.aborted) throw new YahooFetchError('deadline_exceeded');
    let url: URL;
    try {
      url = new URL(input instanceof Request ? input.url : String(input));
    } catch {
      throw new YahooFetchError('invalid_provider_url');
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        !ALLOWED_HOSTS.has(url.hostname)) {
      throw new YahooFetchError('provider_host_rejected');
    }
    if (requests >= maxRequests) throw new YahooFetchError('request_budget_exceeded');

    const request = ++requests;
    const endpoint: SafeYahooRequestEvent['endpoint'] = /\/finance\/quote\/?$/.test(url.pathname)
      ? 'quote' : url.pathname === '/v1/test/getcrumb' ? 'crumb' : 'session';
    const started = performance.now();
    let response: Response;
    try {
      response = await fetchImpl(input, { ...init, signal, redirect: 'manual' });
    } catch {
      report({ endpoint, request, durationMs: Math.round(performance.now() - started), outcome: 'network_error' });
      throw new YahooFetchError(signal.aborted ? 'deadline_exceeded' : 'provider_network_error');
    }
    report({ endpoint, request, durationMs: Math.round(performance.now() - started), status: response.status, outcome: 'response' });

    // yahoo-finance2 logs the full quote URL (including its crumb) on some HTTP
    // errors. Reject here first. Session responses can legitimately be redirects
    // or 404s carrying cookies, so their status is left to the library to handle.
    if (endpoint === 'quote' && !response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new YahooFetchError('provider_quote_http_error');
    }
    return response;
  };
}

export function createYahooFetcher(
  client: YahooQuoteClient,
  options: {
    fetch?: typeof fetch;
    timeoutMs?: number;
    maxRequests?: number;
    log?: LogRequest;
  } = {},
): () => Promise<Quote[]> {
  const timeoutMs = options.timeoutMs ?? YAHOO_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new YahooFetchError('invalid_deadline');
  }

  return async () => {
    const controller = new AbortController();
    const boundedFetch = createBoundedYahooFetch(
      options.fetch ?? fetch, controller.signal,
      options.maxRequests ?? YAHOO_MAX_HTTP_REQUESTS, options.log,
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new YahooFetchError('deadline_exceeded'));
      }, timeoutMs);
    });
    try {
      // Exactly one library quote call: failed refreshes wait for the next
      // database-authorized minute instead of retrying within this attempt.
      const result = await Promise.race([
        client.quote([...QUERY_SYMBOLS], {}, {
          fetch: boundedFetch, fetchOptions: { signal: controller.signal },
        }),
        deadline,
      ]);
      if (!Array.isArray(result)) throw new YahooFetchError('invalid_provider_result');
      return result.filter((quote): quote is Quote =>
        quote !== null && typeof quote === 'object' && typeof quote.symbol === 'string' &&
        ['FUTURE', 'INDEX', 'ETF', 'EQUITY'].includes(quote.quoteType)
      );
    } catch (error) {
      if (error instanceof YahooFetchError) throw error;
      // Provider errors can contain response bodies, query strings, or cookies.
      throw new YahooFetchError('provider_refresh_failed');
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  };
}
