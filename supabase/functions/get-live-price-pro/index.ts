/// <reference lib="deno.ns" />
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createRequestHandler } from './request.ts';

const supabase = createClient(
  Deno.env.get('PROJECT_URL') ?? Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
Deno.serve(createRequestHandler({
  async userId(token) {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user || user.is_anonymous) return null;
    return user.id;
  },
  async readAccessSnapshot(id) {
    // One private RPC reads the current subscription and saved prices together.
    // It cannot refresh prices; visitor requests still never contact Yahoo.
    const { data, error } = await supabase.rpc('read_pro_price_access_snapshot', {
      p_user_id: id,
    });
    if (error) throw new Error('Subscription and price snapshot lookup failed');
    return data;
  },
}));
