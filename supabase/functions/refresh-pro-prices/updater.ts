import { timingSafeEqual } from 'node:crypto';
import type { Quote } from '../get-live-price-pro/pricing.ts';
import { validQuoteArray } from '../get-live-price-pro/snapshot.ts';

export function hasUpdaterAuthorization(req: Request, secret: string | undefined): boolean {
  const token = req.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!secret || !token) return false;
  const encoder = new TextEncoder();
  const expected = encoder.encode(secret);
  const received = encoder.encode(token);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

type Dependencies = {
  authorized: (request: Request) => boolean;
  claim: () => Promise<string | null>;
  fetchQuotes: () => Promise<Quote[]>;
  complete: (claim: string, quotes: Quote[]) => Promise<void>;
  release: (claim: string) => Promise<void>;
};

function response(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
  });
}

// This endpoint accepts no ticker, contract, URL, or force-refresh parameters.
// A DB claim is required before any Yahoo operation, including failed attempts.
export function createUpdater(deps: Dependencies) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return response(405, { message: 'Method not allowed' });
    if (!deps.authorized(req)) return response(401, { message: 'Unauthorized' });
    let claim: string | null = null;
    let completed = false;
    try {
      claim = await deps.claim();
      if (!claim) return response(204);
      const quotes = await deps.fetchQuotes();
      if (!validQuoteArray(quotes)) throw new Error('Invalid Yahoo snapshot');
      await deps.complete(claim, quotes);
      completed = true;
      return response(200, { ok: true });
    } catch {
      // Provider errors can contain cookie/crumb URLs; never print their text.
      console.error('refresh-pro-prices: refresh failed');
      return response(503, { message: 'Unable to refresh Pro prices. Please try again.' });
    } finally {
      if (claim && !completed) {
        try { await deps.release(claim); }
        catch { console.error('refresh-pro-prices: claim release failed'); }
      }
    }
  };
}
