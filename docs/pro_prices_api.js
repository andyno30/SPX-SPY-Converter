import { supabase } from './auth.js';
import { premiumRequestCooldown } from './premium-request-cooldown.js?v=20261015-quota';
import { verifyWebsiteHuman } from './human-verification.js?v=20261016';

const proBackendURL = 'https://isvzhpqrmjtqnqyyidxr.functions.supabase.co/contact-for-licencing';

// getSession refreshes expiring sessions through the existing Supabase client.
// The backend validates the JWT and subscription; client state grants no access.
export async function fetchProPrices(esContract = 'AUTO', signal, { manualProbe = false } = {}) {
  const { data, error } = await supabase.auth.getSession();
  let session = error ? null : data.session;
  const url = new URL(proBackendURL);
  if (esContract !== 'AUTO') url.searchParams.set('esContract', esContract);
  let probe;
  let probeUserId;
  const request = async () => {
    // The existing one-time 401 token refresh is part of the same probe. Its
    // first request was unauthenticated and must not consume a second lease.
    if (!probe || probeUserId !== session.user?.id) {
      probe = await premiumRequestCooldown.begin(session.user?.id, 'pro_prices', { manualProbe });
      probeUserId = session.user?.id;
    }
    return fetch(url, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      // The API's private, no-store response prevents price caching. Default mode
      // lets browsers reuse CORS preflight permission without caching Pro access.
      cache: 'default', signal,
    });
  };
  if (!session) {
    window.location.href = 'login.html';
    throw Object.assign(new Error('Sign in to access Pro prices.'), { status: 401 });
  }
  let requestUserId = session.user?.id;
  let response = await request();
  if (response.status === 401) {
    const refreshed = await supabase.auth.refreshSession();
    session = refreshed.data.session;
    if (!refreshed.error && session) {
      requestUserId = session.user?.id;
      response = await request();
    }
  }
  if (response.status === 401) window.location.href = 'login.html';
  if (response.status === 403) window.location.href = 'dashboard.html';
  let body = await response.json().catch(() => ({}));
  if(response.status===429 && body.code==='HUMAN_VERIFICATION_REQUIRED'){
    const verifiedUser=requestUserId;
    await verifyWebsiteHuman(body,async()=>{
      const current=await supabase.auth.getSession();
      return !current.error&&current.data.session?.user?.id===verifiedUser?current.data.session.access_token:null;
    },signal);
    // One controlled retry. Existing hard quotas and authentication still apply.
    const current=await supabase.auth.getSession();
    if(current.error||current.data.session?.user?.id!==verifiedUser)throw new Error('Your session changed. Sign in and retry.');
    session=current.data.session;response=await request();body=await response.json().catch(()=>({}));
  }
  const cooldownError = await premiumRequestCooldown.responseError(requestUserId, 'pro_prices', response, body);
  if (cooldownError) throw cooldownError;
  if (!response.ok) throw Object.assign(new Error(body.message || 'Unable to refresh Pro prices.'), { status: response.status });
  await premiumRequestCooldown.completeProbe(probe);
  return body;
}
