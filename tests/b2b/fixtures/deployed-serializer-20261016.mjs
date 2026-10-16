// Pure serializer extracted from deployed contact-for-licencing v3 for parity verification.
// Contains no credentials, network access, or production market data.
var ES_CONTRACTS = [
  {
    contract: "ESU26",
    symbol: "ESU26.CME",
    label: "September 2026 (ESU26)"
  },
  {
    contract: "ESZ26",
    symbol: "ESZ26.CME",
    label: "December 2026 (ESZ26)"
  },
  {
    contract: "ESH27",
    symbol: "ESH27.CME",
    label: "March 2027 (ESH27)"
  },
  {
    contract: "ESM27",
    symbol: "ESM27.CME",
    label: "June 2027 (ESM27)"
  },
  {
    contract: "ESU27",
    symbol: "ESU27.CME",
    label: "September 2027 (ESU27)"
  }
];
var SYMBOLS = {
  SPX: "^GSPC",
  SPY: "SPY",
  ES: "ES=F",
  NQ: "NQ=F",
  QQQ: "QQQ",
  NDX: "^NDX",
  RUT: "^RUT",
  IWM: "IWM",
  RTY: "RTY=F",
  DJI: "^DJI",
  DIA: "DIA",
  YM: "YM=F"
};
var QUERY_SYMBOLS = [
  .../* @__PURE__ */ new Set([
    ...Object.values(SYMBOLS),
    ...ES_CONTRACTS.map((c) => c.symbol)
  ])
];
function parseContract(url) {
  const values = new URL(url).searchParams.getAll("esContract");
  if (!values.length) return "AUTO";
  if (values.length !== 1) return null;
  return values[0] === "AUTO" || ES_CONTRACTS.some((c) => c.contract === values[0]) ? values[0] : null;
}
var priceOf = (q) => {
  const value = q?.regularMarketPrice ?? q?.postMarketPrice ?? q?.preMarketPrice ?? q?.previousClose;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
};
var isoDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};
var monthCodes = {
  2: "H",
  5: "M",
  8: "U",
  11: "Z"
};
function contractFromExpiry(q) {
  const iso = isoDate(q?.expireDate);
  if (!iso) return null;
  const date = new Date(iso);
  const month = monthCodes[date.getUTCMonth()];
  return month ? `ES${month}${String(date.getUTCFullYear()).slice(-2)}` : null;
}
function supported(q, contract, now) {
  const expiry = isoDate(q?.expireDate);
  return !!q && q.quoteType === "FUTURE" && typeof q.regularMarketPrice === "number" && Number.isFinite(q.regularMarketPrice) && q.regularMarketPrice > 0 && isoDate(q.regularMarketTime) !== null && contractFromExpiry(q) === contract && !!expiry && expiry.slice(0, 10) >= new Date(now).toISOString().slice(0, 10);
}
var safeDiv = (a, b) => a !== null && b !== null && b !== 0 ? a / b : null;
function priceResponse(snapshot, selection, now = Date.now()) {
  const bySymbol = new Map(snapshot.quotes.map((q) => [
    q.symbol,
    q
  ]));
  const contracts = ES_CONTRACTS.filter((c) => supported(bySymbol.get(c.symbol), c.contract, now));
  const selected = contracts.find((c) => c.contract === selection);
  if (selection !== "AUTO" && !selected) return null;
  const symbol = selected?.symbol ?? SYMBOLS.ES;
  const quote = bySymbol.get(symbol);
  const prices = Object.fromEntries(Object.entries(SYMBOLS).map(([ticker, source]) => [
    ticker,
    priceOf(bySymbol.get(source))
  ]));
  prices.ES = priceOf(quote);
  return {
    Prices: prices,
    "SPX/SPY Ratio": safeDiv(prices.SPX, prices.SPY),
    "ES/SPY Ratio": safeDiv(prices.ES, prices.SPY),
    "NQ/QQQ Ratio": safeDiv(prices.NQ, prices.QQQ),
    "NDX/QQQ Ratio": safeDiv(prices.NDX, prices.QQQ),
    "ES/SPX Ratio": safeDiv(prices.ES, prices.SPX),
    Datetime: snapshot.fetchedAt,
    ESSelection: selection,
    ESContract: selected?.contract ?? contractFromExpiry(quote),
    ESSymbol: symbol,
    ESQuote: {
      name: quote?.shortName ?? symbol,
      timestamp: isoDate(quote?.regularMarketTime),
      expiresAt: isoDate(quote?.expireDate),
      delayMinutes: quote?.exchangeDataDelayedBy ?? null
    },
    ESContracts: contracts
  };
}


export {priceResponse,parseContract,ES_CONTRACTS};
