import { supabase } from './auth.js';

const title = document.getElementById('confirmation-title');
const description = document.getElementById('confirmation-description');
const badge = document.getElementById('confirmation-badge');
const primary = document.getElementById('confirmation-primary');
const secondary = document.getElementById('confirmation-secondary');
const status = document.getElementById('confirmation-status');
const retry = document.getElementById('check-subscription');

async function checkSubscription() {
  retry.hidden = true;
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return; // The static page already provides a login path.

    primary.textContent = 'Open your Dashboard →';
    primary.href = 'dashboard.html';
    secondary.textContent = 'Manage your account';
    secondary.href = 'settings.html';
    status.textContent = 'Checking your Pro access…';
    // Stripe's webhook can arrive just after the browser returns from checkout.
    // Read trusted account state; never grant access from a URL parameter.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { data: profile, error: profileError } = await supabase
        .from('profiles').select('is_subscribed').eq('id', user.id).maybeSingle();
      if (profileError) throw profileError;
      if (profile?.is_subscribed) {
        title.textContent = 'You are subscribed!';
        description.textContent = 'Welcome to SpyConverter Pro. Your Dashboard is ready — let’s get started.';
        badge.textContent = 'Active';
        badge.classList.add('is-pro');
        status.textContent = 'Your Pro subscription is active.';
        return;
      }
      if (attempt < 4) await new Promise(resolve => setTimeout(resolve, 2000));
    }
    title.textContent = 'We’re checking your subscription';
    description.textContent = 'Your Pro access isn’t active yet. If you just paid, it may take a moment to appear.';
    status.textContent = 'Please don’t pay again. Check once more, or contact support if your payment completed.';
    badge.textContent = 'Checking';
    retry.hidden = false;
  } catch {
    status.textContent = 'We couldn’t check your subscription. Open your Dashboard or try again. You don’t need to pay again.';
    retry.hidden = false;
  }
}

retry.addEventListener('click', () => void checkSubscription());
void checkSubscription();
