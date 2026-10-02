import { getSupabaseClient } from './supabase.js';

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
