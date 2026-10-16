import {createClient} from 'npm:@supabase/supabase-js@2';
import {createWebsiteVerification} from '../_shared/website-human-verification.ts';
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
Deno.serve(createWebsiteVerification({
 secret:Deno.env.get('WEBSITE_TURNSTILE_SECRET')||'',
 async authorize(token){
  const {data:{user},error}=await db.auth.getUser(token);if(error||!user||user.is_anonymous)return null;
  const{data,error:accessError}=await db.rpc('read_pro_price_access_snapshot',{p_user_id:user.id});
  return !accessError&&data?.is_subscribed===true?user.id:null;
 },
 async control(id,action,challenge,success){const{data,error}=await db.rpc('website_pro_human_control',{p_user_id:id,p_action:action,p_challenge:challenge||null,p_success:success===true}).abortSignal(AbortSignal.timeout(5000));if(error)throw Error('Verification storage unavailable');return data;},
}));
