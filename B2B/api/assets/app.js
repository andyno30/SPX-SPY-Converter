import {API_ORIGIN} from './config.js';
const $=id=>document.getElementById(id),all=s=>[...document.querySelectorAll(s)];
const local=location.hostname==='127.0.0.1'&&location.port==='8799';
const backend=local?location.origin:API_ORIGIN;
let cfg={},auth=null,token=local?sessionStorage.getItem('sc-b2b-demo-token'):null,user=null,state=null,org=sessionStorage.getItem('sc-b2b-organization'),revealed=null;
const returnParams=new URL(location.href).searchParams,checkoutReturn=returnParams.get('checkout');
let confirmationPoll=0,checkoutOrganizationSelected=false;
const toast=message=>{ $('toast').textContent=message;setTimeout(()=>{$('toast').textContent='';},5000); };
function error(e){if($('dashboard-message'))$('dashboard-message').textContent=e.message||'Something went wrong.';else toast(e.message);}
function show(id,value=true){$(id).hidden=!value;}
function format(n){return Number(n||0).toLocaleString('en-US');}
function date(value){return value?new Date(value).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}):'Not active';}
function renderConfirmation(timedOut=false){
 if(!$('checkout-confirmation')||!['complete','cancelled'].includes(checkoutReturn))return false;
 show('checkout-confirmation');
 const s=state?.subscription,unmatched=!!user&&(!org||(returnParams.get('organization_id')&&returnParams.get('organization_id')!==org)),paid=!!(!unmatched&&user&&s?.status==='active'&&s.stripe_subscription_id&&Date.parse(s.paid_through)>Date.now());
 $('confirmation-title').textContent=checkoutReturn==='cancelled'?'Checkout cancelled':!user?'Confirm your subscription':unmatched?'No payment linked to this account':paid?(s.livemode===false?'Test payment confirmed':'Payment confirmed'):timedOut?'Payment confirmation is taking longer':'Confirming your subscription';
 $('confirmation-message').textContent=checkoutReturn==='cancelled'?'You returned without completing this checkout. You can review your plan and continue from Billing.':!user?'Sign in to the account you used for checkout to securely confirm your subscription and receive your API key.':unmatched?'We could not find this B2B checkout in your signed-in account. Use the account that started checkout, or contact support before paying again.':paid?`${cfg.plans?.[s.plan]?.name||s.plan} · $${(cfg.plans?.[s.plan]?.cents||0)/100}/month USD. Your payment has been verified. ${revealed?'Your API key is ready below. Copy it now and store it securely.':state.keys.some(k=>!k.revoked_at)?'Your API keys are available in this workspace.':'Your API key will appear automatically when activation is complete.'}`:timedOut?'We have not received verified payment confirmation yet. You do not need to pay again. Check the status below or contact support if this continues.':'We are waiting for verified payment confirmation from Stripe. Your API key will appear automatically after activation. You do not need to pay again.';
 $('checkout-confirmation').dataset.state=paid?'confirmed':checkoutReturn==='cancelled'?'cancelled':'pending';
 $('confirmation-icon').textContent=paid?'✓':checkoutReturn==='cancelled'?'↩':'…';
 show('confirmation-check',!!user&&checkoutReturn==='complete'&&!paid);
 show('confirmation-keys',paid&&state.keys.some(k=>!k.revoked_at));
 return paid;
}
async function watchConfirmation(){
 const run=++confirmationPoll,expectedOrg=org;
 if(checkoutReturn!=='complete'||!user||!org||(returnParams.get('organization_id')&&returnParams.get('organization_id')!==org)||renderConfirmation())return;
 for(let attempt=0;attempt<24;attempt++){
  await new Promise(resolve=>setTimeout(resolve,5000));
  if(run!==confirmationPoll||!user||org!==expectedOrg)return;
  try{await refresh();if(renderConfirmation())return;}catch{renderConfirmation(true);return;}
 }
 renderConfirmation(true);
}
async function request(path,data){
 if(!backend)throw new Error('The API service is temporarily unavailable. Please try again later.');
 if(auth){const{data:{session}}=await auth.supabase.auth.getSession();token=session?.access_token;}
 const response=await fetch(backend+path,{method:data===undefined?'GET':'POST',headers:{...(token?{Authorization:`Bearer ${token}`} :{}),...(data===undefined?{}:{'Content-Type':'application/json'})},body:data===undefined?undefined:JSON.stringify(data)});
 const result=await response.json();if(!response.ok)throw new Error(result.error?.message||'The request could not be completed.');return result;
}
function row(cells){const tr=document.createElement('tr');for(const cell of cells){const td=document.createElement('td');if(cell instanceof Node)td.append(cell);else td.textContent=String(cell??'—');tr.append(td);}return tr;}
function button(label,action){const b=document.createElement('button');b.type='button';b.className='text-button';b.textContent=label;b.addEventListener('click',()=>busy(b,action));return b;}
async function busy(b,action){b.disabled=true;if($('dashboard-message'))$('dashboard-message').textContent='';try{await action();}catch(e){error(e);}finally{b.disabled=false;if(state&&document.body.dataset.page==='dashboard')render();}}
function empty(tbody,columns,message){const tr=row([message]);tr.firstChild.colSpan=columns;tr.firstChild.className='empty';tbody.append(tr);}
function selectPanel(name){all('[data-panel]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.panel===name)));all('[data-section]').forEach(s=>s.hidden=s.dataset.section!==name);}
all('[data-code]').forEach(b=>b.addEventListener('click',()=>{all('[data-code]').forEach(t=>t.setAttribute('aria-selected',String(t===b)));all('[data-example]').forEach(p=>p.hidden=p.dataset.example!==b.dataset.code);}));
all('[role=tablist]').forEach(list=>list.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;const tabs=[...list.querySelectorAll('[role=tab]')],i=tabs.indexOf(document.activeElement);if(i<0)return;e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tabs[next].focus();tabs[next].click();}));
all('[data-panel]').forEach(b=>b.addEventListener('click',()=>selectPanel(b.dataset.panel)));
all('[data-open]').forEach(b=>b.addEventListener('click',()=>selectPanel(b.dataset.open)));
all('pre > code').forEach(code=>{const copy=document.createElement('button');copy.type='button';copy.className='button secondary compact';copy.textContent='Copy example';copy.addEventListener('click',()=>busy(copy,async()=>{await navigator.clipboard.writeText(code.textContent);toast('Example copied.');}));code.parentElement.append(copy);});
function forgetKey(){revealed=null;if($('new-key-value'))$('new-key-value').textContent='';if($('key-test-result')){$('key-test-result').textContent='';show('key-test-result',false);}if($('key-reveal'))show('key-reveal',false);}
function reveal(result){forgetKey();revealed=result.key;$('new-key-value').textContent=revealed;show('key-reveal');$('key-reveal').scrollIntoView({block:'nearest',behavior:'smooth'});}
async function refresh(){
 const data=await request('/platform/organizations');
 const organizations=data.organizations;$('organization-select').replaceChildren();
 for(const o of organizations){const opt=document.createElement('option');opt.value=o.id;opt.textContent=o.name;$('organization-select').append(opt);}
 const returnedOrg=returnParams.get('organization_id');
 if(!checkoutOrganizationSelected&&organizations.some(o=>o.id===returnedOrg)){org=returnedOrg;checkoutOrganizationSelected=true;}
 if(!organizations.some(o=>o.id===org))org=organizations[0]?.id||null;
 show('auth-panel',false);show('workspace');$('account-email').textContent=user?.email||'Signed in';
 if(!org){state=null;show('account-view',false);show('organization-form-panel');renderConfirmation();return;}
 $('organization-select').value=org;sessionStorage.setItem('sc-b2b-organization',org);state=await request(`/platform/dashboard?organization_id=${encodeURIComponent(org)}`);
 render();show('account-view');show('organization-form-panel',false);
 if(state.role==='owner'&&state.subscription.status==='active'&&!state.keys.length){
  const provisionOrg=org,result=await request('/platform/keys/provision',{organization_id:org});
  if(result.created&&org===provisionOrg){state.keys.push(result.record);render();selectPanel('keys');reveal(result);toast('Your initial API key is ready. Copy it now and store it securely.');}
 }
 renderConfirmation();
}
function render(){
 const{subscription:s,usage:u,organization:o}=state;const plan=cfg.plans?.[s.plan];
 $('metric-plan').textContent=plan?.name||s.plan;$('metric-status').textContent=s.status.replaceAll('_',' ');$('metric-used').textContent=format(u.used);$('metric-quota').textContent=`of ${format(u.quota)} this period`;$('metric-remaining').textContent=format(u.remaining);$('metric-rate').textContent=`${u.per_minute} / min`;
 $('usage-summary').textContent=`${format(u.used)} of ${format(u.quota)} conversion requests used`;$('usage-progress').value=u.used/u.quota*100;$('period-start').textContent=`Started ${date(u.period_start)}`;$('period-end').textContent=`Resets ${date(u.period_end)}`;
 $('application-status').textContent=state.applications.length?`${state.applications.at(-1).plan.toUpperCase()} application: ${state.applications.at(-1).status}. ${o.business_approved?'Business review approved.':'Business review is required for the Business plan.'}`:'No pending application.';
 $('billing-plan').textContent=`${plan?.name||s.plan} · $${(plan?.cents||0)/100}/month USD`;$('billing-status').textContent=`Subscription: ${s.status.replaceAll('_',' ')}. Paid through ${date(s.paid_through)}.`;$('cancel-status').textContent=s.cancel_at_period_end?'Cancellation is scheduled for the end of the paid period.':'No cancellation is scheduled.';
 $('checkout').disabled=!cfg.billing_enabled||state.role!=='owner'||['active','past_due','unpaid','incomplete'].includes(s.status);$('portal').disabled=state.role!=='owner'||!s.stripe_customer_id;
 const accepted=state.agreements.some(a=>a.provider==='terms-acceptance'&&a.version===cfg.agreement_version&&a.document_sha256===cfg.agreement_sha256);
 $('agreement-status').textContent=accepted?'Terms accepted. Your receipt is securely recorded.':'Review and accept the current Terms before checkout.';
 $('terms-version').textContent=`Version ${String(cfg.agreement_version||'pending approval').replace(/^(\d{4})-\d{2}-\d{2}-v\d+$/,'$1')}${cfg.terms_acceptance_enabled?'':' · acceptance opens after approval'}`;
 $('terms-accepted').checked=false;$('terms-accepted').disabled=accepted||state.role!=='owner'||!cfg.terms_acceptance_enabled;$('accept-terms').disabled=$('terms-accepted').disabled;
 $('checkout').disabled||=!accepted||(s.plan==='business'&&!o.business_approved);$('business-status').textContent=o.business_approved?'Business review: approved in this environment.':'Business review: pending if Business is selected.';
 show('simulate-approval',local&&s.plan==='business');$('simulate-approval').disabled=state.role!=='owner';
 $('organization-details').textContent=`${o.name} · ${o.legal_name} · ${o.email}. Your role: ${state.role}.`;
 $('keys-table').replaceChildren();for(const k of state.keys){const actions=document.createElement('div');actions.className='key-actions';if(!k.revoked_at&&state.role==='owner'){actions.append(button('Rotate',async()=>{if(!confirm(`Rotate ${k.label}? The existing key will stop working immediately.`))return;const result=await request('/platform/keys',{organization_id:org,label:k.label,mode:k.mode,rotate_key_id:k.id});await refresh();reveal(result);}),button('Revoke',async()=>{if(!confirm(`Revoke ${k.label}? Applications using this key will lose access.`))return;await request('/platform/keys/revoke',{organization_id:org,key_id:k.id});forgetKey();await refresh();toast('Key revoked.');}));}$('keys-table').append(row([k.label,`${k.prefix}…`,k.revoked_at?'Revoked':k.mode==='test'?'Test · active':'Live · active',actions]));}if(!state.keys.length)empty($('keys-table'),4,'Your initial key becomes available automatically after all activation requirements are verified.');
 $('members-table').replaceChildren();for(const m of state.members){$('members-table').append(row([m.user_id,m.role,state.role==='owner'?button('Remove',async()=>{await request('/platform/members',{organization_id:org,user_id:m.user_id,action:'remove'});await refresh();}):'—']));}
 $('daily-table').replaceChildren();$('usage-chart').replaceChildren();const max=Math.max(1,...state.daily_usage.map(d=>Number(d.requests)));for(const day of state.daily_usage){$('daily-table').append(row([day.day,format(day.requests),format(day.errors),format(day.rate_limits)]));const bar=document.createElement('div');bar.className='chart-bar';bar.style.height=`${Math.max(6,Number(day.requests)/max*120)}px`;bar.title=`${day.day}: ${day.requests} requests`;const label=document.createElement('span');label.textContent=format(day.requests);bar.append(label);$('usage-chart').append(bar);}if(!state.daily_usage.length){empty($('daily-table'),4,'No request events yet. API activity will appear here after activation.');$('usage-chart').textContent='Your first API request will appear here.';}
 $('history-table').replaceChildren();for(const h of state.history)$('history-table').append(row([date(h.period_start),date(h.period_end),format(h.used)]));if(!state.history.length)empty($('history-table'),3,'Billing-period history appears after activation.');
 for(const formId of ['key-form','member-form','upgrade-form'])for(const el of $(formId).elements)el.disabled=state.role!=='owner';
 if(s.status!=='active'||(!local&&!cfg.live_market_data_enabled))$('key-form').querySelector('button').disabled=true;
 if(!local){const modes=$('key-form').elements.mode;for(const option of modes.options){option.disabled=option.value==='test'?!cfg.synthetic:!cfg.live_market_data_enabled;if(option.value==='live')option.textContent=cfg.live_market_data_enabled?'Live':'Live · not yet available';}modes.value=cfg.synthetic?'test':'live';}
}
function authMessage(message){$('auth-message').textContent=message;}
async function accountEmail(action){
 if(local)throw new Error('Email delivery is unavailable in the local demonstration.');
 const input=$('auth-form').elements.email;
 if(!input.reportValidity())return;
 if(!auth)auth=await import('/docs/auth.js');
 const {error:e}=action==='resend'?await auth.supabase.auth.resend({type:'signup',email:input.value,options:{emailRedirectTo:location.origin+'/B2B/api/dashboard/'}}):await auth.supabase.auth.resetPasswordForEmail(input.value,{redirectTo:location.origin+'/docs/reset-password.html'});
 if(e){if(e.code==='over_email_send_rate_limit')throw new Error('Supabase has temporarily reached its email limit. Your password has not changed. Try again later, or use Google sign-in for this email address.');throw e;}
 authMessage(action==='resend'?'If this account needs confirmation, a new confirmation email has been requested. Check spam as well. Already confirmed accounts can sign in.':'If this account supports password recovery, a reset email has been requested. After resetting your password, return to this API dashboard.');
}
async function signIn(register=false){
 const d=Object.fromEntries(new FormData($('auth-form')));
 if(!$('auth-form').reportValidity())return;
 if(register&&d.password.length<10)throw new Error('Use at least 10 characters when creating a new account. Existing accounts can sign in with their current password.');
 if(local){const result=await request('/local/auth',{...d,action:register?'register':'login'});token=result.token;user=result.user;sessionStorage.setItem('sc-b2b-demo-token',token);sessionStorage.setItem('sc-b2b-demo-user',JSON.stringify(user));}
 else{if(register)throw new Error('Use Continue with Google to create your B2B account without a confirmation email.');if(!auth)auth=await import('/docs/auth.js');const{data,error:e}=await auth.supabase.auth.signInWithPassword({email:d.email,password:d.password});if(e)throw e;if(!data.session){$('auth-form').elements.password.value='';authMessage('Sign-in did not establish a session. Use Google to register without a confirmation email, or sign in with an existing verified account.');return;}user=data.user;token=data.session.access_token;}
 $('auth-form').elements.password.value='';await refresh();void watchConfirmation();
}
async function redirectBilling(path){const result=await request(path,{organization_id:org,plan:state.subscription.plan});const target=new URL(result.url);if(!(local&&target.origin===location.origin)&&!(target.protocol==='https:'&&['checkout.stripe.com','billing.stripe.com'].includes(target.hostname)))throw new Error('The billing URL could not be verified.');location.assign(target.href);}
if(document.body.dataset.page==='dashboard'){
 if(['complete','cancelled'].includes(checkoutReturn)){document.querySelector('.dashboard-heading h1').textContent='Subscription confirmation';document.querySelector('.dashboard-heading p:not(.eyebrow)').textContent='Your checkout status and next steps.';}
 renderConfirmation();
 $('confirmation-check').addEventListener('click',()=>busy($('confirmation-check'),async()=>{await refresh();void watchConfirmation();}));
 $('confirmation-keys').addEventListener('click',()=>{selectPanel('keys');document.querySelector('[data-section="keys"]').scrollIntoView({block:'start',behavior:'smooth'});});
 $('auth-form').addEventListener('submit',e=>{e.preventDefault();busy(e.submitter,()=>signIn());});$('register').addEventListener('click',e=>busy(e.currentTarget,()=>signIn(true)));
 $('resend-confirmation').addEventListener('click',e=>busy(e.currentTarget,()=>accountEmail('resend')));
 $('forgot-password').addEventListener('click',e=>busy(e.currentTarget,()=>accountEmail('reset')));
 $('google-login').addEventListener('click',e=>busy(e.currentTarget,async()=>{if(local)throw new Error('Google sign-in is available on the production website.');if(!auth)auth=await import('/docs/auth.js');const{error:e}=await auth.supabase.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin+'/B2B/api/dashboard/'}});if(e)throw e;}));
 $('organization-select').addEventListener('change',async()=>{forgetKey();org=$('organization-select').value;try{await refresh();void watchConfirmation();}catch(e){error(e);}});
 $('new-org').addEventListener('click',()=>{forgetKey();show('account-view',false);show('organization-form-panel');});$('cancel-org').addEventListener('click',()=>{show('organization-form-panel',false);show('account-view',!!org);});
 $('organization-form').addEventListener('submit',e=>{e.preventDefault();busy(e.submitter,async()=>{const result=await request('/platform/organizations',Object.fromEntries(new FormData(e.target)));org=result.organization.id;await refresh();selectPanel('billing');toast('Application created. Complete the activation prerequisites.');});});
 $('key-form').addEventListener('submit',e=>{e.preventDefault();busy(e.submitter,async()=>{const result=await request('/platform/keys',{organization_id:org,...Object.fromEntries(new FormData(e.target))});await refresh();reveal(result);});});
 $('copy-key').addEventListener('click',()=>busy($('copy-key'),async()=>{await navigator.clipboard.writeText(revealed);toast('Key copied. Store it securely on your server.');}));$('dismiss-key').addEventListener('click',forgetKey);
 $('test-key').addEventListener('click',()=>busy($('test-key'),async()=>{const r=await fetch(backend+'/v1/conversions',{headers:{Authorization:`Bearer ${revealed}`}});$('key-test-result').textContent=`HTTP ${r.status}\n${JSON.stringify(await r.json(),null,2)}`;show('key-test-result');await refresh();}));
 $('member-form').addEventListener('submit',e=>{e.preventDefault();busy(e.submitter,async()=>{await request('/platform/members',{organization_id:org,action:'add',...Object.fromEntries(new FormData(e.target))});await refresh();toast('Organization membership updated.');});});
 $('upgrade-form').addEventListener('submit',e=>{e.preventDefault();busy(e.submitter,async()=>{await request('/platform/applications',{organization_id:org,...Object.fromEntries(new FormData(e.target))});await refresh();toast('Review requested. Your subscription has not changed.');});});
 $('terms-form').addEventListener('submit',e=>{e.preventDefault();busy(e.submitter,async()=>{if(!$('terms-accepted').checked)throw new Error('Read and accept the Terms to continue.');await request('/platform/agreement',{organization_id:org,accepted:true,version:cfg.agreement_version,document_sha256:cfg.agreement_sha256});await refresh();toast('Terms acceptance recorded.');});});
 $('checkout').addEventListener('click',()=>busy($('checkout'),()=>redirectBilling('/platform/checkout')));$('portal').addEventListener('click',()=>busy($('portal'),()=>redirectBilling('/platform/portal')));
 $('simulate-approval').addEventListener('click',()=>busy($('simulate-approval'),async()=>{await request('/local/business-approval',{organization_id:org});await refresh();toast('Synthetic Business approval recorded.');}));
 $('logout').addEventListener('click',()=>busy($('logout'),async()=>{forgetKey();if(local){await request('/local/logout',{});sessionStorage.removeItem('sc-b2b-demo-token');sessionStorage.removeItem('sc-b2b-demo-user');}else if(auth)await auth.supabase.auth.signOut();token=null;user=null;org=null;state=null;confirmationPoll++;show('workspace',false);show('auth-panel');renderConfirmation();}));
 try{
  if(local){$('environment-tag').textContent='SYNTHETIC PREVIEW';$('auth-form').elements.email.value='developer@example.test';$('auth-form').elements.password.value='local-demo-only';show('demo-credentials');$('register').textContent='Create test account';show('register');show('google-login',false);show('forgot-password',false);$('environment-notice').textContent='Local demonstration: synthetic accounts, data, agreements, and payment events. No real billing.';}
  if(backend)cfg=await request('/platform/config');
  if(!local){$('auth-form').reset();$('auth-form').elements.email.value='';$('auth-form').elements.password.value='';show('demo-credentials',false);$('register').textContent='Create account';show('register',false);show('resend-confirmation',false);authMessage('New accounts use Google sign-in. No confirmation email is required. Existing accounts can also use their current password.');$('environment-notice').textContent=cfg.billing_enabled&&cfg.live_market_data_enabled?'Production API account. Payments are processed securely by Stripe.':'Paid activation is not yet available, and unavailable access cannot be purchased.';}
  const plan=new URL(location.href).searchParams.get('plan');if(['developer','pro','business'].includes(plan))$('organization-form').elements.plan.value=plan;
  if(local&&token){user=JSON.parse(sessionStorage.getItem('sc-b2b-demo-user')||'null');await refresh();}else if(backend&&!local){auth=await import('/docs/auth.js');const{data:{session}}=await auth.supabase.auth.getSession();if(session){token=session.access_token;user=session.user;await refresh();}}

  void watchConfirmation();
 }catch(e){error(e);}
}

if(document.body.dataset.page!=='dashboard'&&backend&&!local){try{const config=await request('/platform/config');if(config.terms_acceptance_enabled&&$('terms-review-notice'))$('terms-review-notice').textContent='Approved Terms. Review the full agreement, then accept it in your authenticated dashboard before checkout.';if(config.billing_enabled&&config.live_market_data_enabled)all('[data-availability]').forEach(node=>node.textContent='Monthly API subscriptions are available. Complete onboarding and secure Stripe Checkout to activate your organization.');}catch{/* Keep the truthful default availability notice on connectivity failures. */}}
