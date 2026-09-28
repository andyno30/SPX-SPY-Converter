import type { Quote, Snapshot } from './pricing.ts';

export const MAX_SNAPSHOT_AGE_MS = 120_000;
export const MAX_FUTURE_SKEW_MS = 5_000;
export type SnapshotRecord = { quotes: unknown; fetched_at: unknown };

export function validQuoteArray(value: unknown): value is Quote[] {
  return Array.isArray(value) && value.length > 0 && value.every(quote =>
    quote !== null && typeof quote === 'object' && !Array.isArray(quote) &&
    typeof quote.symbol === 'string' && quote.symbol.trim().length > 0
  );
}

// Freshness describes when Yahoo was fetched, not the market timestamp (which
// may legitimately be delayed or from the last trading session).
export function createSnapshotReader(
  readRecord: () => Promise<SnapshotRecord | null>,
  now = Date.now,
): () => Promise<Snapshot> {
  return async () => {
    const record = await readRecord();
    if (!record || !validQuoteArray(record.quotes) || typeof record.fetched_at !== 'string') {
      throw new Error('Price snapshot unavailable');
    }
    const fetchedAt = Date.parse(record.fetched_at);
    const age = now() - fetchedAt;
    if (!Number.isFinite(fetchedAt) || age > MAX_SNAPSHOT_AGE_MS || age < -MAX_FUTURE_SKEW_MS) {
      throw new Error('Price snapshot expired');
    }
    return { quotes: record.quotes, fetchedAt: new Date(fetchedAt).toISOString() };
  };
}
