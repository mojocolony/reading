export const APP_NAME = 'Reading';
export const APP_VERSION = '0.1.10';
export const GITHUB_PAGES_BASE = '/reading/';

export function getPublicConfig(source = globalThis.READING_CONFIG ?? {}) {
  return {
    supabaseUrl: String(source.supabaseUrl ?? '').trim(),
    supabaseKey: String(source.supabaseKey ?? '').trim(),
    demoMode: source.demoMode === true,
  };
}

export function isCloudConfigured(config = getPublicConfig()) {
  return Boolean(config.supabaseUrl && config.supabaseKey);
}
