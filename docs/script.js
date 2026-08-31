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
  const planDescription = document.getElementById('plan-description');
  const displayNameEl = document.getElementById('user-display-name');
  const identityTitle = document.getElementById('identity-title');
  const identityDescription = document.getElementById('identity-description');
  const avatar = document.getElementById('dashboard-avatar');
  const avatarImage = document.getElementById('dashboard-avatar-image');
  const avatarFallback = document.getElementById('dashboard-avatar-fallback');

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

  if (emailEl) emailEl.textContent = user.email || 'Signed-in account';

  const [{ data: profile, error: profileError }, { data: identity }] = await Promise.all([
    supabase.from('profiles').select('is_subscribed').eq('id', user.id).maybeSingle(),
    supabase.from('user_profiles').select('nickname,avatar_url').eq('user_id', user.id).maybeSingle(),
  ]);

  const subscribed = !profileError && !!profile?.is_subscribed;
  if (statusEl) statusEl.textContent = subscribed ? 'SpyConverter Pro' : 'Free account';
  if (planDescription) planDescription.textContent = subscribed
    ? 'Your subscription is active and the professional converter is unlocked.'
    : 'Upgrade when you are ready to unlock the professional converter.';

  if (subscribeBtn) subscribeBtn.hidden = subscribed;
  if (accessBtn) accessBtn.hidden = !subscribed;

  const nickname = identity?.nickname || '';
  const fallbackName = user.email?.split('@')[0] || 'Trader';
  const shownName = nickname || fallbackName;
  if (displayNameEl) displayNameEl.textContent = shownName;
  if (identityTitle) identityTitle.textContent = nickname || 'Set your nickname';
  if (identityDescription) identityDescription.textContent = nickname
    ? 'This is the name other traders see beside your News comments.'
    : 'Choose what other traders see beside your News comments.';

  if (avatar && avatarFallback) {
    const parts = shownName.split(/[\s._-]+/).filter(Boolean);
    avatarFallback.textContent = (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : shownName.slice(0, 2)).toUpperCase();
    const hue = [...user.id].reduce((hash, char) => ((hash * 31) + char.charCodeAt(0)) % 360, 218);
    avatar.style.setProperty('--avatar-hue', String(hue));
  }
  if (avatarImage && avatarFallback && identity?.avatar_url) {
    avatarImage.src = identity.avatar_url;
    avatarImage.hidden = false;
    avatarFallback.hidden = true;
    avatarImage.addEventListener('error', () => {
      avatarImage.hidden = true;
      avatarFallback.hidden = false;
    }, { once: true });
  }
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

async function initializeDashboard() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    window.location.replace('login.html');
    return;
  }

  await fetchUserInfo();
  const shell = document.getElementById('dashboard-shell');
  shell?.setAttribute('aria-busy', 'false');
  shell?.classList.add('is-ready');

  const message = document.getElementById('dashboard-message');
  if (window.location.search.includes('success=true') && message) {
    message.textContent = 'Payment received. Your Pro access may take a few seconds to activate.';
    message.hidden = false;
    setTimeout(() => void fetchUserInfo(), 3000);
  }

  document.getElementById('subscribe-btn')?.addEventListener('click', () => {
    window.location.href = '../pro.html#pricing';
  });
  document.getElementById('access-spyconverterpro-btn')?.addEventListener('click', () => {
    window.location.href = 'spyconverterpro.html';
  });
  document.getElementById('dashboard-logout')?.addEventListener('click', async () => {
    await signOut();
    window.location.replace('login.html');
  });
}

if (document.body.hasAttribute('data-dashboard-page')) void initializeDashboard();
