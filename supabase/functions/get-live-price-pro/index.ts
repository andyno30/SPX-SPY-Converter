/// <reference lib="deno.ns" />
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createAuthorizer } from './authorization.ts';
import { createHandler } from './handler.ts';
import { createSnapshotReader } from './snapshot.ts';

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
// Visitor requests can only read the private snapshot. Even an empty/stale cache
// must never trigger Yahoo work; only the separately protected updater does that.
const snapshot = createSnapshotReader(async () => {
  const { data, error } = await supabase.from('pro_price_cache')
    .select('quotes,fetched_at').eq('id', 1).maybeSingle();
  if (error) throw new Error('Price snapshot lookup failed');
  return data;
});
Deno.serve(createHandler({ authorize, snapshot }));
