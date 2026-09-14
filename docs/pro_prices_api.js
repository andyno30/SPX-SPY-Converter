import { supabase } from './auth.js';

const proBackendURL = 'https://isvzhpqrmjtqnqyyidxr.functions.supabase.co/get-live-price-pro';

// getSession refreshes expiring sessions through the existing Supabase client.
// The backend validates the JWT and subscription; client state grants no access.
export async function fetchProPrices(esContract = 'AUTO', signal) {
  const { data, error } = await supabase.auth.getSession();
  let session = error ? null : data.session;
  const url = new URL(proBackendURL);
  if (esContract !== 'AUTO') url.searchParams.set('esContract', esContract);
  const request = () => fetch(url, {
    headers: { Authorization: `Bearer ${session.access_token}` },
    cache: 'no-store', signal,
  });
  if (!session) {
    window.location.href = 'login.html';
    throw Object.assign(new Error('Sign in to access Pro prices.'), { status: 401 });
  }
  let response = await request();
  if (response.status === 401) {
    const refreshed = await supabase.auth.refreshSession();
    session = refreshed.data.session;
    if (!refreshed.error && session) response = await request();
  }
  if (response.status === 401) window.location.href = 'login.html';
  if (response.status === 403) window.location.href = 'dashboard.html';
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body.message || 'Unable to refresh Pro prices.'), { status: response.status });
  return body;
}
