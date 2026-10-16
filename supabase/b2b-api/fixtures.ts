// Synthetic-only values. This fixture never obtains or tracks market quotes.
import { SYMBOLS, ES_CONTRACTS } from '../functions/get-live-price-pro/pricing.ts';
export function syntheticSnapshot(now:number,revision=0){
  const prices=[7000,700,7050,20500,500,20000,2400,240,2420,45000,450,45200];
  const quotes:any[]=Object.entries(SYMBOLS).map(([ticker,symbol],i)=>({symbol,quoteType:['ES','NQ','RTY','YM'].includes(ticker)?'FUTURE':'INDEX',shortName:`Synthetic ${ticker}`,regularMarketPrice:prices[i]+revision,regularMarketTime:new Date(now).toISOString(),exchangeDataDelayedBy:i%2?15:0}));
  quotes.find(q=>q.symbol==='ES=F').expireDate='2026-12-18T00:00:00.000Z';
  const dates=['2026-09-18','2026-12-18','2027-03-19','2027-06-18','2027-09-17'];
  ES_CONTRACTS.forEach((c,i)=>quotes.push({symbol:c.symbol,quoteType:'FUTURE',shortName:`Synthetic ${c.contract}`,regularMarketPrice:7100+i*25+revision,regularMarketTime:new Date(now).toISOString(),expireDate:`${dates[i]}T00:00:00.000Z`,exchangeDataDelayedBy:10}));
  return{quotes,fetched_at:new Date(now).toISOString()};
}
