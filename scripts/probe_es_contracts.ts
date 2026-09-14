// Read-only provider check. Run with Deno 2; requires network access to Yahoo.
import YahooFinance from 'npm:yahoo-finance2@4.0.2';
import { ES_CONTRACTS, priceResponse, QUERY_SYMBOLS, type Quote } from '../supabase/functions/get-live-price-pro/pricing.ts';

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
// ESZ27 is deliberately only a probe, not a selectable contract until verified.
const raw = await yf.quote([...QUERY_SYMBOLS, 'ESZ27.CME']);
const quotes: Quote[] = raw.filter(q => q.quoteType === 'FUTURE' || q.quoteType === 'INDEX' || q.quoteType === 'ETF' || q.quoteType === 'EQUITY');
const snapshot = { quotes, fetchedAt: new Date().toISOString() };
const rows = ['AUTO', ...ES_CONTRACTS.map(c => c.contract)].map(selection => {
  const data = priceResponse(snapshot, selection);
  return { selection, symbol: data?.ESSymbol, contract: data?.ESContract, price: data?.Prices.ES,
    timestamp: data?.ESQuote.timestamp, delayMinutes: data?.ESQuote.delayMinutes,
    esSpyRatio: data?.['ES/SPY Ratio'], esSpxRatio: data?.['ES/SPX Ratio'] };
});
console.log(JSON.stringify({ fetchedAt: snapshot.fetchedAt, rows, december2027: quotes.find(q => q.symbol === 'ESZ27.CME') ?? null }, null, 2));
if (rows.some(row => !row.price)) throw new Error('An allowlisted contract was unavailable; inspect before deployment.');
