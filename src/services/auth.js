import { getSupabaseClient } from './supabase.js';

export function signInErrorMessage(error) {
  if (error?.code === 'invalid_credentials') return 'Email or password was not accepted.';
  if (error?.code === 'email_not_confirmed') return 'Confirm the email address before signing in.';
  if (error?.code === 'over_request_rate_limit' || error?.status === 429) return 'Too many sign-in attempts. Wait a few minutes and try again.';
  if (error?.name === 'AuthRetryableFetchError' || error?.name === 'TypeError' || /fetch|network|connection/i.test(error?.message ?? '')) return 'Reading could not connect to the sign-in service. Reload and try again.';
  return 'Reading could not sign in right now. Reload and try again.';
}

export async function signIn(email, password) {
  const client = await getSupabaseClient();
  if (!client) throw new Error('Cloud sync is not configured.');
  const { data, error } = await client.auth.signInWithPassword({ email: String(email).trim(), password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const client = await getSupabaseClient();
  if (!client) return;
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

export async function getCurrentUser() {
  const client = await getSupabaseClient();
  if (!client) return null;
  const { data, error } = await client.auth.getUser();
  if (error) return null;
  return data.user ?? null;
}
