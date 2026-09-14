// Only independently verified Yahoo contracts belong here. Add future expirations
// after running the provider probe; availability is checked again on every refresh.
export const ES_CONTRACTS = [
  { contract: 'ESU26', symbol: 'ESU26.CME', label: 'September 2026 (ESU26)' },
  { contract: 'ESZ26', symbol: 'ESZ26.CME', label: 'December 2026 (ESZ26)' },
  { contract: 'ESH27', symbol: 'ESH27.CME', label: 'March 2027 (ESH27)' },
  { contract: 'ESM27', symbol: 'ESM27.CME', label: 'June 2027 (ESM27)' },
  { contract: 'ESU27', symbol: 'ESU27.CME', label: 'September 2027 (ESU27)' },
] as const;

export const SYMBOLS = {
  SPX: '^GSPC', SPY: 'SPY', ES: 'ES=F', NQ: 'NQ=F', QQQ: 'QQQ',
  NDX: '^NDX', RUT: '^RUT', IWM: 'IWM', RTY: 'RTY=F',
  DJI: '^DJI', DIA: 'DIA', YM: 'YM=F',
} as const;
export type Ticker = keyof typeof SYMBOLS;
export type Quote = {
  symbol: string;
  quoteType?: string;
  shortName?: string;
  regularMarketPrice?: number;
  postMarketPrice?: number;
  preMarketPrice?: number;
  previousClose?: number;
  regularMarketTime?: Date | string;
  expireDate?: Date | string;
  exchangeDataDelayedBy?: number;
};
export type Snapshot = { quotes: Quote[]; fetchedAt: string };
export const CACHE_MS = 60_000;
export const QUERY_SYMBOLS = [...new Set([
  ...Object.values(SYMBOLS), ...ES_CONTRACTS.map(c => c.symbol),
])];

export function parseContract(url: string): string | null {
  const values = new URL(url).searchParams.getAll('esContract');
  if (!values.length) return 'AUTO';
  if (values.length !== 1) return null;
  return values[0] === 'AUTO' || ES_CONTRACTS.some(c => c.contract === values[0])
    ? values[0] : null;
}
const priceOf = (q?: Quote) => {
  const value = q?.regularMarketPrice ?? q?.postMarketPrice ?? q?.preMarketPrice ?? q?.previousClose;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
};
const isoDate = (value?: Date | string) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};
const monthCodes: Record<number, string> = { 2: 'H', 5: 'M', 8: 'U', 11: 'Z' };
function contractFromExpiry(q?: Quote): string | null {
  const iso = isoDate(q?.expireDate);
  if (!iso) return null;
  const date = new Date(iso);
  const month = monthCodes[date.getUTCMonth()];
  return month ? `ES${month}${String(date.getUTCFullYear()).slice(-2)}` : null;
}
function supported(q: Quote | undefined, contract: string, now: number): q is Quote {
  const expiry = isoDate(q?.expireDate);
  return !!q && q.quoteType === 'FUTURE' &&
    typeof q.regularMarketPrice === 'number' && Number.isFinite(q.regularMarketPrice) && q.regularMarketPrice > 0 &&
    isoDate(q.regularMarketTime) !== null && contractFromExpiry(q) === contract &&
    !!expiry && expiry.slice(0, 10) >= new Date(now).toISOString().slice(0, 10);
}
const safeDiv = (a: number | null, b: number | null) =>
  a !== null && b !== null && b !== 0 ? a / b : null;

export function priceResponse(snapshot: Snapshot, selection: string, now = Date.now()) {
  const bySymbol = new Map(snapshot.quotes.map(q => [q.symbol, q]));
  const contracts = ES_CONTRACTS.filter(c => supported(bySymbol.get(c.symbol), c.contract, now));
  const selected = contracts.find(c => c.contract === selection);
  if (selection !== 'AUTO' && !selected) return null; // Never substitute continuous ES.
  const symbol = selected?.symbol ?? SYMBOLS.ES;
  const quote = bySymbol.get(symbol);
  const prices = Object.fromEntries(Object.entries(SYMBOLS).map(([ticker, source]) =>
    [ticker, priceOf(bySymbol.get(source))]
  )) as Record<Ticker, number | null>;
  prices.ES = priceOf(quote);
  return {
    Prices: prices,
    'SPX/SPY Ratio': safeDiv(prices.SPX, prices.SPY),
    'ES/SPY Ratio': safeDiv(prices.ES, prices.SPY),
    'NQ/QQQ Ratio': safeDiv(prices.NQ, prices.QQQ),
    'NDX/QQQ Ratio': safeDiv(prices.NDX, prices.QQQ),
    'ES/SPX Ratio': safeDiv(prices.ES, prices.SPX),
    Datetime: snapshot.fetchedAt,
    ESSelection: selection,
    ESContract: selected?.contract ?? contractFromExpiry(quote),
    ESSymbol: symbol,
    ESQuote: {
      name: quote?.shortName ?? symbol,
      timestamp: isoDate(quote?.regularMarketTime),
      expiresAt: isoDate(quote?.expireDate),
      delayMinutes: quote?.exchangeDataDelayedBy ?? null,
    },
    ESContracts: contracts,
  };
}

// One 60-second snapshot and in-flight latch per warm instance. All selections use
// the same base instruments; changing contracts does not refetch twelve tickers.
export function createSnapshotCache(fetchQuotes: () => Promise<Quote[]>, now = Date.now) {
  let cached: Snapshot | null = null;
  let cachedAt = 0;
  let inFlight: Promise<Snapshot> | null = null;
  return () => {
    if (cached && now() - cachedAt < CACHE_MS) return Promise.resolve(cached);
    if (!inFlight) {
      inFlight = fetchQuotes().then(quotes => {
        cachedAt = now();
        cached = { quotes, fetchedAt: new Date(cachedAt).toISOString() };
        return cached;
      }).finally(() => { inFlight = null; });
    }
    return inFlight;
  };
}
