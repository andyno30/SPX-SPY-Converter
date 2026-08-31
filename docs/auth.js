// /docs/auth.js
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Your Supabase project credentials
const supabaseUrl = 'https://isvzhpqrmjtqnqyyidxr.supabase.co';
const supabaseAnonKey = 'sb_publishable_f5EYFGZ8NNT7dczGGyBnCA_T1uOvDaf';

// Create Supabase client
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Sign up with email/password
 */
export async function signUp(email, password, emailRedirectTo) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: emailRedirectTo ? { emailRedirectTo } : undefined,
  });
  if (error) throw error;
  return data;
}

/**
 * Login with email/password
 */
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
  return data;
}

/**
 * Login/Signup with Google OAuth (optional redirect)
 */
export async function signInWithGoogle(redirectTo) {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: redirectTo ? { redirectTo } : undefined,
  });
  if (error) throw error;
  return data;
}

/**
 * Send password reset email — redirects to reset-password.html
 */
export async function resetPassword(email) {
  const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/docs/reset-password.html',
  });
  if (error) throw error;
  return data;
}

/**
 * Get the current logged-in user
 */
export function getUser() {
  return supabase.auth.getUser();
}

/**
 * Sign out current user
 */
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
