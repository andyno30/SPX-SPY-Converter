// /docs/auth.js
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Your Supabase project credentials
const supabaseUrl = 'https://isvzhpqrmjtqnqyyidxr.supabase.co';
const supabaseAnonKey =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlzdnpocHFybWp0cW5xeXlpZHhyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ3NjczNjMsImV4cCI6MjA3MDM0MzM2M30.eC2k3bZrApDDOXBLLq6rZ6Wu_n0TXc9aLg4IAbdeAIc';

// Create Supabase client
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Sign up with email/password
 */
export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });
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
