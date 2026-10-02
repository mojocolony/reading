import { getPublicConfig, isCloudConfigured } from '../config.js';

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4/+esm';
let clientPromise = null;

export async function getSupabaseClient() {
  const config = getPublicConfig();
  if (!isCloudConfigured(config)) return null;
  if (!clientPromise) {
    clientPromise = import(SDK_URL).then(({ createClient }) => createClient(config.supabaseUrl, config.supabaseKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    }));
  }
  return clientPromise;
}

export function resetSupabaseClientForTests() {
  clientPromise = null;
}
