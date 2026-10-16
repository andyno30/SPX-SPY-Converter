/// <reference lib="deno.ns" />
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createRequestHandler } from '../get-live-price-pro/request.ts';
import { createRuntimeQuotaConsumer } from '../_shared/premium-quota.ts';
import { createWebsiteHumanGuard } from '../_shared/website-human-verification.ts';

const supabase = createClient(
  Deno.env.get('PROJECT_URL') ?? Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
Deno.serve(createRequestHandler({
  humanCheck: Deno.env.get('WEBSITE_TURNSTILE_SITEKEY') ? createWebsiteHumanGuard(async(id,action)=>{
    const {data,error}=await supabase.rpc('website_pro_human_control',{p_user_id:id,p_action:action}).abortSignal(AbortSignal.timeout(5000));
    if(error)throw new Error('Website verification lookup failed');return data;
  },Deno.env.get('WEBSITE_TURNSTILE_SITEKEY')!) : undefined,
  // Off by default. Enable only after the approved SQL migration and smoke tests.
  consumeQuota: Deno.env.get('PRO_PRICE_QUOTAS_ENABLED') === 'true'
    ? createRuntimeQuotaConsumer({
      async readControl() {
        const { data, error } = await supabase.rpc('read_premium_api_quota_control', {
          p_resource: 'pro-prices',
        }).abortSignal(AbortSignal.timeout(2_000));
        if (error) throw new Error('Quota control lookup failed');
        return data;
      },
      async consume(id) {
        const { data, error } = await supabase.rpc('consume_premium_api_quota', {
          p_user_id: id, p_resource: 'pro-prices',
        }).abortSignal(AbortSignal.timeout(5_000));
        if (error) throw new Error('Premium quota lookup failed');
        return data;
      },
    }) : undefined,
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
