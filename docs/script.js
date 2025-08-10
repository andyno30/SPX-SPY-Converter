// /docs/script.js
import { supabase, signOut } from './auth.js';

/**
 * Fetch and show the current user's email and subscription status.
 * Taps Supabase session + profiles table (is_subscribed).
 * Exposes: window.fetchUserInfo
 */
async function fetchUserInfo() {
  const emailEl = document.getElementById('user-email');
  const statusEl = document.getElementById('user-status');
  const subscribeBtn = document.getElementById('subscribe-btn');
  const accessBtn = document.getElementById('access-spyconverterpro-btn');

  // Default UI while loading
  if (emailEl) emailEl.textContent = 'Loading...';
  if (statusEl) statusEl.textContent = '';

  // Grab current user from Supabase session
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    if (emailEl) emailEl.textContent = 'Not logged in.';
    if (statusEl) statusEl.textContent = '';
    if (subscribeBtn) subscribeBtn.style.display = 'none';
    if (accessBtn) accessBtn.style.display = 'none';
    return;
  }

  if (emailEl) emailEl.textContent = `Email: ${user.email}`;

  // Read subscription from profiles
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('is_subscribed')
    .eq('id', user.id)
    .single();

  const subscribed = !profileError && !!profile?.is_subscribed;
  if (statusEl) statusEl.textContent = `Status: ${subscribed ? 'Subscribed' : 'Not Subscribed'}`;

  if (subscribeBtn) subscribeBtn.style.display = subscribed ? 'none' : 'inline-block';
  if (accessBtn) accessBtn.style.display = subscribed ? 'inline-block' : 'none';
}

/**
 * Subscribe flow.
 * Calls Supabase Edge Function "subscribe" to start a Stripe Checkout session.
 * Exposes: window.subscribe
 */
async function subscribe(plan = 'monthly') {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const feedback = document.getElementById('delete-feedback');

  if (!token) {
    if (feedback) feedback.textContent = 'You must be logged in to subscribe.';
    return;
  }

  const resp = await fetch('https://isvzhpqrmjtqnqyyidxr.functions.supabase.co/subscribe', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ plan }) // 'monthly' or 'six_months'
  });

  const data = await resp.json().catch(() => ({}));
  if (resp.ok && data.url) {
    window.location.href = data.url; // Go to Stripe Checkout
  } else {
    alert(data.message || 'Subscription failed');
  }
}

/**
 * Delete account flow.
 * Calls Supabase Edge Function "delete-account" to remove user and their data.
 * Exposes: window.deleteAccount
 */
async function deleteAccount() {
  const feedback = document.getElementById('delete-feedback');
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  if (!token) {
    if (feedback) feedback.textContent = 'You must be logged in to delete your account.';
    return;
  }

  const resp = await fetch('https://isvzhpqrmjtqnqyyidxr.functions.supabase.co/delete-account', {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`,
    }
  });

  const data = await resp.json().catch(() => ({}));
  if (resp.ok) {
    await signOut();
    window.location.href = 'login.html';
  } else {
    if (feedback) feedback.textContent = data.message || 'Error deleting account';
  }
}

// Expose the functions globally so your inline handlers still work
window.fetchUserInfo = fetchUserInfo;
window.deleteAccount = deleteAccount;
window.subscribe = subscribe;
