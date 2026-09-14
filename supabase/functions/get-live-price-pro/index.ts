/// <reference lib="deno.ns" />
import YahooFinance from 'npm:yahoo-finance2@4.0.2';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createAuthorizer } from './authorization.ts';
import { createHandler } from './handler.ts';
import { createSnapshotCache, QUERY_SYMBOLS } from './pricing.ts';

const supabase = createClient(
  Deno.env.get('PROJECT_URL') ?? Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const authorize = createAuthorizer({
  async userId(token) {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user || user.is_anonymous) return null;
    return user.id;
  },
  async subscribed(id) {
    const { data, error } = await supabase.from('profiles')
      .select('is_subscribed').eq('id', id).maybeSingle();
    if (error) throw new Error('Subscription lookup failed');
    return data?.is_subscribed === true;
  },
});
const yf = new YahooFinance();
const snapshot = createSnapshotCache(async () => {
  const quotes = await yf.quote(QUERY_SYMBOLS);
  return quotes.filter(quote => quote.quoteType === 'FUTURE' ||
    quote.quoteType === 'INDEX' || quote.quoteType === 'ETF' || quote.quoteType === 'EQUITY');
});
Deno.serve(createHandler({ authorize, snapshot }));
