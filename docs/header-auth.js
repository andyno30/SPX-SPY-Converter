import { signOut, supabase } from './auth.js';

const LOGIN_URL = 'https://spyconverter.com/docs/login.html';

function setLoggedOut(link) {
  link.textContent = 'Log in';
  link.href = LOGIN_URL;
  link.dataset.loggedIn = 'false';
}

function setLoggedIn(link) {
  link.textContent = 'Log out';
  link.href = '#';
  link.dataset.loggedIn = 'true';
}

async function initializeHeaderAuth() {
  const link = document.querySelector('[data-auth-link]');
  if (!(link instanceof HTMLAnchorElement)) return;

  try {
    const { data } = await supabase.auth.getUser();
    if (data.user) setLoggedIn(link);
    else setLoggedOut(link);
  } catch {
    setLoggedOut(link);
  }

  link.addEventListener('click', async (event) => {
    if (link.dataset.loggedIn !== 'true') return;
    event.preventDefault();
    link.setAttribute('aria-busy', 'true');
    try {
      await signOut();
      setLoggedOut(link);
    } finally {
      link.removeAttribute('aria-busy');
    }
  });

  supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.user) setLoggedIn(link);
    else setLoggedOut(link);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void initializeHeaderAuth(), { once: true });
} else {
  void initializeHeaderAuth();
}
