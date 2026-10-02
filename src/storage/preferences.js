const PREFS_KEY = 'reading:preferences:v1';
const VALID_SCALES = new Set(['small', 'medium', 'large']);
const VALID_THEMES = new Set(['system', 'light', 'dark']);

const DEFAULTS = Object.freeze({
  fontScale: 'medium',
  themeMode: 'system',
  nonfictionFilter: false,
  nowReadingCollapsed: false,
  queuedCollapsed: false,
  nowReadingFictionCollapsed: false,
  nowReadingNonfictionCollapsed: false,
  queuedFictionCollapsed: false,
  queuedNonfictionCollapsed: false,
  archiveFictionCollapsed: false,
  archiveNonfictionCollapsed: false,
  expandedBookIds: [],
});

function normalize(value = {}) {
  return {
    fontScale: VALID_SCALES.has(value.fontScale) ? value.fontScale : DEFAULTS.fontScale,
    themeMode: VALID_THEMES.has(value.themeMode) ? value.themeMode : DEFAULTS.themeMode,
    nonfictionFilter: value.nonfictionFilter === true,
    nowReadingCollapsed: value.nowReadingCollapsed === true,
    queuedCollapsed: value.queuedCollapsed === true,
    nowReadingFictionCollapsed: value.nowReadingFictionCollapsed === true,
    nowReadingNonfictionCollapsed: value.nowReadingNonfictionCollapsed === true,
    queuedFictionCollapsed: value.queuedFictionCollapsed === true,
    queuedNonfictionCollapsed: value.queuedNonfictionCollapsed === true,
    archiveFictionCollapsed: value.archiveFictionCollapsed === true,
    archiveNonfictionCollapsed: value.archiveNonfictionCollapsed === true,
    expandedBookIds: Array.isArray(value.expandedBookIds) ? [...new Set(value.expandedBookIds.map(String))] : [],
  };
}

function safeStorage(storage) {
  return storage ?? globalThis.localStorage;
}

export function readPreferences(storage) {
  try {
    const raw = safeStorage(storage)?.getItem(PREFS_KEY);
    return raw ? normalize(JSON.parse(raw)) : { ...DEFAULTS, expandedBookIds: [] };
  } catch {
    return { ...DEFAULTS, expandedBookIds: [] };
  }
}

export function writePreferences(preferences, storage) {
  safeStorage(storage)?.setItem(PREFS_KEY, JSON.stringify(normalize(preferences)));
}

export { DEFAULTS as DEFAULT_PREFERENCES, PREFS_KEY };
