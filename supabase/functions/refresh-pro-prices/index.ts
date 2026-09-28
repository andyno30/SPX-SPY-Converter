/// <reference lib="deno.ns" />
import YahooFinance from 'npm:yahoo-finance2@4.0.2';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createUpdater, hasUpdaterAuthorization } from './updater.ts';
import { createYahooFetcher } from './yahoo.ts';

const serviceKey = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(
  Deno.env.get('PROJECT_URL') ?? Deno.env.get('SUPABASE_URL')!,
  serviceKey,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

// The provider wrapper emits only safe counts/statuses. Library diagnostics can
// include Yahoo cookies or crumb URLs, so keep those diagnostics disabled.
const silent = () => {};
const yf = new YahooFinance({
  versionCheck: false,
  suppressNotices: ['yahooSurvey'],
  logger: { info: silent, warn: silent, error: silent, debug: silent, dir: silent },
  validation: { logErrors: false, logOptionsErrors: false },
});

Deno.serve(createUpdater({
  authorized: req => hasUpdaterAuthorization(req, serviceKey),
  async claim() {
    const { data, error } = await supabase.rpc('claim_pro_price_refresh')
      .abortSignal(AbortSignal.timeout(10_000));
    if (error || (data !== null && typeof data !== 'string')) {
      throw new Error('Price refresh claim failed');
    }
    return data as string | null;
  },
  fetchQuotes: createYahooFetcher(yf, {
    log: event => console.info('pro_prices_yahoo_request', JSON.stringify(event)),
  }),
  async complete(claim, quotes) {
    const { data, error } = await supabase.rpc('finish_pro_price_refresh', {
      p_claim_token: claim, p_quotes: quotes,
    }).abortSignal(AbortSignal.timeout(10_000));
    if (error || data !== true) throw new Error('Price refresh completion failed');
  },
  async release(claim) {
    const { error } = await supabase.rpc('release_pro_price_refresh', {
      p_claim_token: claim,
    }).abortSignal(AbortSignal.timeout(10_000));
    if (error) throw new Error('Price refresh release failed');
  },
}));
