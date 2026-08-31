import { signOut, supabase } from './auth.js';

const shell = document.getElementById('settings-shell');
const pageMessage = document.getElementById('page-message');
const accountEmail = document.getElementById('account-email');
const currentEmail = document.getElementById('current-email');
const planBadge = document.getElementById('plan-badge');
const billingBadge = document.getElementById('billing-badge');
const billingDescription = document.getElementById('billing-description');
const manageBillingButton = document.getElementById('manage-billing');
const viewPlansLink = document.getElementById('view-plans');
const avatarImage = document.getElementById('avatar-image');
const avatarFallback = document.getElementById('avatar-fallback');
const avatarPreview = document.getElementById('avatar-preview');
const avatarInput = document.getElementById('avatar-input');
const removeAvatarButton = document.getElementById('remove-avatar');
const nicknameInput = document.getElementById('nickname-input');
const nicknameSummary = document.getElementById('nickname-summary');
const deleteConfirmation = document.getElementById('delete-confirmation');
const deleteAccountButton = document.getElementById('delete-account');

let currentUser = null;
let publicProfile = null;

function setStatus(id, message, kind = '') {
  const element = document.getElementById(id);
  if (!element) return;
  element.textContent = message;
  element.classList.toggle('is-success', kind === 'success');
  element.classList.toggle('is-error', kind === 'error');
}

function setPageMessage(message) {
  pageMessage.textContent = message;
  pageMessage.hidden = !message;
}

function initialsFor(nickname, email) {
  const source = (nickname || email?.split('@')[0] || 'Trader').trim();
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : source.slice(0, 2)).toUpperCase();
}

function hueFor(value) {
  return [...String(value)].reduce((hash, char) => ((hash * 31) + char.charCodeAt(0)) % 360, 218);
}

function renderAvatar() {
  const nickname = publicProfile?.nickname || '';
  avatarFallback.textContent = initialsFor(nickname, currentUser?.email);
  avatarPreview.style.setProperty('--avatar-hue', String(hueFor(currentUser?.id || currentUser?.email)));
  nicknameInput.value = nickname;
  nicknameSummary.textContent = nickname
    ? `${nickname} — shown publicly on News comments`
    : 'Not set — comments use your account name';

  if (publicProfile?.avatar_url) {
    avatarImage.src = publicProfile.avatar_url;
    avatarImage.hidden = false;
    avatarFallback.hidden = true;
    removeAvatarButton.hidden = false;
  } else {
    avatarImage.removeAttribute('src');
    avatarImage.hidden = true;
    avatarFallback.hidden = false;
    removeAvatarButton.hidden = true;
  }
}

async function upsertPublicProfile(changes) {
  const { data, error } = await supabase
    .from('user_profiles')
    .upsert({
      user_id: currentUser.id,
      nickname: publicProfile?.nickname ?? null,
      avatar_url: publicProfile?.avatar_url ?? null,
      avatar_path: publicProfile?.avatar_path ?? null,
      ...changes,
    }, { onConflict: 'user_id' })
    .select('user_id,nickname,avatar_url,avatar_path')
    .single();
  if (error) throw error;
  publicProfile = data;
  return data;
}

async function initialize() {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    const returnTo = encodeURIComponent('https://spyconverter.com/docs/settings.html');
    window.location.replace(`login.html?return_to=${returnTo}`);
    return;
  }

  currentUser = user;
  accountEmail.textContent = user.email || 'Signed-in account';
  currentEmail.textContent = user.email || 'Not available';

  const [{ data: identity, error: identityError }, { data: billing, error: billingError }] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('user_id,nickname,avatar_url,avatar_path')
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('profiles')
      .select('is_subscribed')
      .eq('id', user.id)
      .maybeSingle(),
  ]);

  if (identityError) setPageMessage('Your public profile could not be loaded. You can still manage sign-in security.');
  publicProfile = identity || null;
  renderAvatar();

  const subscribed = !billingError && Boolean(billing?.is_subscribed);
  planBadge.textContent = subscribed ? 'Pro' : 'Free';
  billingBadge.textContent = subscribed ? 'Active' : 'Free';
  planBadge.classList.toggle('is-pro', subscribed);
  billingBadge.classList.toggle('is-pro', subscribed);
  billingDescription.textContent = subscribed
    ? 'Active subscription — billing is securely managed by Stripe.'
    : 'No active subscription. Upgrade for the professional converter.';
  manageBillingButton.hidden = !subscribed;
  viewPlansLink.hidden = subscribed;

  shell.setAttribute('aria-busy', 'false');
  shell.classList.add('is-ready');
}

document.getElementById('nickname-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const nickname = nicknameInput.value.trim();
  if (nickname && !/^[A-Za-z0-9][A-Za-z0-9_.-]{2,29}$/.test(nickname)) {
    setStatus('nickname-status', 'Use 3–30 allowed characters and start with a letter or number.', 'error');
    return;
  }

  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  setStatus('nickname-status', 'Saving…');
  try {
    await upsertPublicProfile({ nickname: nickname || null });
    await supabase.auth.updateUser({ data: { nickname: nickname || null } });
    renderAvatar();
    setStatus('nickname-status', nickname ? 'Nickname saved. Your comments now use it.' : 'Nickname removed.', 'success');
  } catch (error) {
    const duplicate = error?.code === '23505';
    setStatus('nickname-status', duplicate ? 'That nickname is already taken.' : 'Nickname could not be saved. Please try again.', 'error');
  } finally {
    button.disabled = false;
  }
});

avatarInput.addEventListener('change', async () => {
  const file = avatarInput.files?.[0];
  avatarInput.value = '';
  if (!file) return;
  const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
  if (!allowedTypes.has(file.type)) {
    setStatus('avatar-status', 'Choose a JPG, PNG, WEBP, or GIF image.', 'error');
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    setStatus('avatar-status', 'That image is larger than 2 MB.', 'error');
    return;
  }

  const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
  const path = `${currentUser.id}/avatar-${crypto.randomUUID()}.${extensions[file.type]}`;
  const oldPath = publicProfile?.avatar_path || null;
  setStatus('avatar-status', 'Uploading photo…');

  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(path, file, { cacheControl: '31536000', contentType: file.type, upsert: false });
  if (uploadError) {
    setStatus('avatar-status', 'Photo could not be uploaded. Please try again.', 'error');
    return;
  }

  const { data: publicUrlData } = supabase.storage.from('avatars').getPublicUrl(path);
  try {
    await upsertPublicProfile({ avatar_url: publicUrlData.publicUrl, avatar_path: path });
    await supabase.auth.updateUser({ data: { avatar_url: publicUrlData.publicUrl } });
    if (oldPath && oldPath !== path) await supabase.storage.from('avatars').remove([oldPath]);
    renderAvatar();
    setStatus('avatar-status', 'Profile photo updated.', 'success');
  } catch {
    await supabase.storage.from('avatars').remove([path]);
    setStatus('avatar-status', 'Photo uploaded but the profile could not be updated.', 'error');
  }
});

avatarImage.addEventListener('error', () => {
  avatarImage.hidden = true;
  avatarFallback.hidden = false;
});

removeAvatarButton.addEventListener('click', async () => {
  const oldPath = publicProfile?.avatar_path;
  removeAvatarButton.disabled = true;
  setStatus('avatar-status', 'Removing photo…');
  try {
    if (oldPath) await supabase.storage.from('avatars').remove([oldPath]);
    await upsertPublicProfile({ avatar_url: null, avatar_path: null });
    await supabase.auth.updateUser({ data: { avatar_url: null } });
    renderAvatar();
    setStatus('avatar-status', 'Profile photo removed. Your custom monogram is back.', 'success');
  } catch {
    setStatus('avatar-status', 'Photo could not be removed. Please try again.', 'error');
  } finally {
    removeAvatarButton.disabled = false;
  }
});

document.getElementById('email-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const emailInput = document.getElementById('email-input');
  const email = emailInput.value.trim();
  if (!email || email.toLowerCase() === currentUser.email?.toLowerCase()) {
    setStatus('email-status', 'Enter a different email address.', 'error');
    return;
  }

  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  setStatus('email-status', 'Requesting email change…');
  const { error } = await supabase.auth.updateUser(
    { email },
    { emailRedirectTo: 'https://spyconverter.com/docs/settings.html' },
  );
  if (error) {
    setStatus('email-status', error.message || 'Email could not be changed.', 'error');
  } else {
    emailInput.value = '';
    setStatus('email-status', 'Check your inbox to confirm the new email address.', 'success');
  }
  button.disabled = false;
});

document.getElementById('password-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const password = document.getElementById('password-input').value;
  const confirmation = document.getElementById('confirm-password-input').value;
  if (password.length < 8) {
    setStatus('password-status', 'Your password must be at least 8 characters.', 'error');
    return;
  }
  if (password !== confirmation) {
    setStatus('password-status', 'The passwords do not match.', 'error');
    return;
  }

  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  setStatus('password-status', 'Updating password…');
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    setStatus('password-status', error.message || 'Password could not be changed.', 'error');
  } else {
    form.reset();
    setStatus('password-status', 'Password changed successfully.', 'success');
  }
  button.disabled = false;
});

manageBillingButton.addEventListener('click', async () => {
  manageBillingButton.disabled = true;
  setStatus('billing-status', 'Opening secure billing portal…');
  const { data: { session } } = await supabase.auth.getSession();
  try {
    const response = await fetch('https://isvzhpqrmjtqnqyyidxr.functions.supabase.co/customer-portal', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session?.access_token || ''}` },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.url) throw new Error(data.message || 'Billing portal unavailable.');
    window.location.href = data.url;
  } catch (error) {
    setStatus('billing-status', error.message || 'Billing portal could not be opened.', 'error');
    manageBillingButton.disabled = false;
  }
});

deleteConfirmation.addEventListener('input', () => {
  deleteAccountButton.disabled = deleteConfirmation.value !== 'DELETE';
});

deleteAccountButton.addEventListener('click', async () => {
  if (deleteConfirmation.value !== 'DELETE') return;
  if (!window.confirm('Permanently delete your SpyConverter account and all associated data?')) return;
  deleteAccountButton.disabled = true;
  setStatus('delete-status', 'Deleting your account and canceling any active subscription…');
  const { data: { session } } = await supabase.auth.getSession();
  const response = await fetch('https://isvzhpqrmjtqnqyyidxr.functions.supabase.co/delete-account', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${session?.access_token || ''}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    setStatus('delete-status', data.message || 'Account deletion failed. Please contact support.', 'error');
    deleteAccountButton.disabled = false;
    return;
  }
  await signOut();
  window.location.replace('login.html');
});

document.getElementById('logout-button').addEventListener('click', async () => {
  await signOut();
  window.location.replace('login.html');
});

void initialize();
