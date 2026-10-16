import {createClient} from 'npm:@supabase/supabase-js@2';
import {createFreeCalculator} from '../_shared/free-calculations.ts';
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
Deno.serve(createFreeCalculator({
 gatewaySecret:Deno.env.get('B2B_GATEWAY_SECRET')||'',
 turnstileSecret:Deno.env.get('WEBSITE_TURNSTILE_SECRET')||'',
 sitekey:'0x4AAAAAAFYuYWUcIqoM4vKc',
 async control(id,action,challenge,success){const{data,error}=await db.rpc('website_free_human_control',{p_visitor_id:id,p_action:action,p_challenge:challenge||null,p_success:success===true}).abortSignal(AbortSignal.timeout(5000));if(error)throw Error('Verification storage unavailable');return data;},
}));
