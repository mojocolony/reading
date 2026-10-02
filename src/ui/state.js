const FONT_SCALES = new Set(['small', 'medium', 'large']);
const THEME_MODES = new Set(['system', 'light', 'dark']);
const STATUS_KEYS = {
  now_reading: 'nowReadingCollapsed',
  queued: 'queuedCollapsed',
};
const CATEGORY_KEYS = {
  'now_reading:fiction': 'nowReadingFictionCollapsed',
  'now_reading:nonfiction': 'nowReadingNonfictionCollapsed',
  'queued:fiction': 'queuedFictionCollapsed',
  'queued:nonfiction': 'queuedNonfictionCollapsed',
  'archive:fiction': 'archiveFictionCollapsed',
  'archive:nonfiction': 'archiveNonfictionCollapsed',
};

export function reduceState(state, action) {
  switch (action.type) {
    case 'toggle-book': {
      const ids = new Set(state.preferences.expandedBookIds ?? []);
      ids.has(action.bookId) ? ids.delete(action.bookId) : ids.add(action.bookId);
      return { ...state, preferences: { ...state.preferences, expandedBookIds: [...ids] } };
    }
    case 'toggle-status': {
      const key = STATUS_KEYS[action.status];
      if (!key) return state;
      return { ...state, preferences: { ...state.preferences, [key]: !state.preferences[key] } };
    }
    case 'toggle-category': {
      const key = CATEGORY_KEYS[`${action.scope}:${action.category}`];
      if (!key) return state;
      return { ...state, preferences: { ...state.preferences, [key]: !state.preferences[key] } };
    }
    case 'toggle-nonfiction-filter':
      return { ...state, preferences: { ...state.preferences, nonfictionFilter: !state.preferences.nonfictionFilter } };
    case 'set-font-scale':
      if (!FONT_SCALES.has(action.fontScale)) return state;
      return { ...state, preferences: { ...state.preferences, fontScale: action.fontScale } };
    case 'set-theme-mode':
      return { ...state, preferences: { ...state.preferences, themeMode: THEME_MODES.has(action.themeMode) ? action.themeMode : 'system' } };
    case 'open-menu':
      return { ...state, menuOpen: true, bookMenuId: null };
    case 'close-menu':
      return { ...state, menuOpen: false };
    case 'open-book-menu':
      return { ...state, bookMenuId: action.bookId, menuOpen: false };
    case 'close-book-menu':
      return { ...state, bookMenuId: null };
    case 'open-add':
      return { ...state, sheet: 'add', editingBookId: null, menuOpen: false, bookMenuId: null };
    case 'open-edit':
      return { ...state, sheet: 'edit', editingBookId: action.bookId, menuOpen: false, bookMenuId: null };
    case 'close-sheet':
      return { ...state, sheet: null, editingBookId: null };
    case 'open-archive':
      return { ...state, view: 'archive', menuOpen: false, sheet: null, bookMenuId: null };
    case 'close-archive':
      return { ...state, view: 'main', bookMenuId: null };
    default:
      return state;
  }
}
