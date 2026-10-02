import { getPublicConfig, isCloudConfigured } from './config.js';
import { DEMO_BOOKS } from './demo-data.js';
import { changedPlacements, moveBook } from './domain/ordering.js';
import { normalizeBook, normalizeDescription, normalizeIsbn13, normalizeYear } from './domain/books.js';
import { getCurrentUser, signIn, signOut } from './services/auth.js';
import { getSupabaseClient } from './services/supabase.js';
import { hydrateSearchResult, searchBooks } from './services/book-search.js';
import { refreshCriticalReception, clearCriticalReceptionMemoryCache } from './services/critical-reception.js';
import { createRepository } from './data/repository.js';
import { clearCachedSnapshot, readCachedSnapshot, writeCachedSnapshot } from './storage/cache.js';
import { readPreferences, writePreferences } from './storage/preferences.js';
import { renderAppMarkup, renderBookForm, renderFetchedBookForm } from './ui/app-shell.js';
import { icon } from './ui/icons.js';
import { renderAuthView } from './ui/auth-view.js';
import { attachDragController } from './ui/drag-controller.js';
import { reduceState } from './ui/state.js';
import { canMutate } from './ui/write-guard.js';

const root = document.querySelector('#app');
const config = getPublicConfig();
const demoRequested = new URLSearchParams(location.search).get('demo') === '1';
const demoMode = demoRequested || !isCloudConfigured(config) || config.demoMode;

let currentUser = null;
let repository = null;
let offlineReadOnly = false;
let searchTimer = null;
let searchRequest = 0;
let searchAbortController = null;
let searchResults = [];
let selectedBook = null;
let detachDrag = null;

let state = {
  books: initialBooks(),
  preferences: readPreferences(),
  menuOpen: false,
  bookMenuId: null,
  sheet: null,
  editingBookId: null,
  view: 'main',
};

function initialBooks() {
  const cached = readCachedSnapshot();
  if (cached?.books?.length) return cached.books.map(normalizeBook);
  return demoMode ? structuredClone(DEMO_BOOKS).map(normalizeBook) : [];
}

function render() {
  root.innerHTML = renderAppMarkup(state);
  document.documentElement.dataset.fontScale = state.preferences.fontScale;
  document.documentElement.dataset.theme = state.preferences.themeMode ?? 'system';
  detachDrag?.();
  detachDrag = attachDragController(root, handleDragMove);
  queueMicrotask(() => refreshCriticalReception(root, state.books, handleResolvedBookMarksUrl));
}

function commit(next, { cacheBooks = false, savePrefs = false } = {}) {
  state = next;
  if (savePrefs) writePreferences(state.preferences);
  if (cacheBooks) writeCachedSnapshot({ books: state.books, cachedAt: new Date().toISOString() });
  render();
}

function dispatch(action, options) {
  commit(reduceState(state, action), options);
}

function ensureWritable() {
  if (canMutate({ demoMode, repository, offlineReadOnly })) return true;
  showToast('Offline — changes are disabled until sync is available.');
  return false;
}

root.addEventListener('click', async event => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  if (root.dataset.suppressBookClick === '1' && action === 'toggle-book') return;

  switch (action) {
    case 'toggle-book':
      dispatch({ type: 'toggle-book', bookId: target.dataset.bookId }, { savePrefs: true });
      break;
    case 'toggle-status':
      dispatch({ type: 'toggle-status', status: target.dataset.status }, { savePrefs: true });
      break;
    case 'toggle-category':
      dispatch({ type: 'toggle-category', scope: target.dataset.scope, category: target.dataset.category }, { savePrefs: true });
      break;
    case 'toggle-nonfiction-filter':
      dispatch({ type: 'toggle-nonfiction-filter' }, { savePrefs: true });
      break;
    case 'open-menu':
      dispatch({ type: 'open-menu' });
      break;
    case 'close-menu':
      dispatch({ type: 'close-menu' });
      break;
    case 'open-book-menu':
      dispatch({ type: 'open-book-menu', bookId: target.dataset.bookId });
      break;
    case 'close-book-menu':
      dispatch({ type: 'close-book-menu' });
      break;
    case 'add-book':
      if (!ensureWritable()) break;
      resetAddState();
      dispatch({ type: 'open-add' });
      queueMicrotask(() => root.querySelector('#book-search')?.focus());
      break;
    case 'close-sheet':
      resetAddState();
      dispatch({ type: 'close-sheet' });
      break;
    case 'start-manual-add':
      showManualAddForm();
      break;
    case 'select-search-result':
      await selectSearchResult(Number(target.dataset.resultIndex));
      break;
    case 'save-fetched-book':
      await saveFetchedBook();
      break;
    case 'save-manual-book':
      await saveManualBook();
      break;
    case 'edit-book':
      dispatch({ type: 'open-edit', bookId: target.dataset.bookId });
      break;
    case 'save-edit-book':
      await saveEditBook();
      break;
    case 'move-book-status':
      await moveBookFromMenu(target.dataset.bookId, target.dataset.status, null);
      break;
    case 'move-book-category':
      await moveBookFromMenu(target.dataset.bookId, null, target.dataset.category);
      break;
    case 'finish-book':
      await finishBook(target.dataset.bookId);
      break;
    case 'restore-book':
      await restoreBook(target.dataset.bookId);
      break;
    case 'delete-book':
      await deleteBook(target.dataset.bookId);
      break;
    case 'open-archive':
      dispatch({ type: 'open-archive' });
      break;
    case 'close-archive':
      dispatch({ type: 'close-archive' });
      break;
    case 'set-font-scale':
      dispatch({ type: 'set-font-scale', fontScale: target.dataset.fontScale }, { savePrefs: true });
      break;
    case 'set-theme-mode':
      dispatch({ type: 'set-theme-mode', themeMode: target.dataset.themeMode }, { savePrefs: true });
      break;
    case 'sign-in':
      await handleSignIn();
      break;
    case 'sign-out':
      await handleSignOut();
      break;
  }
});

root.addEventListener('input', event => {
  if (event.target.matches('[data-field="book-search"]')) scheduleSearch(event.target.value);
});

async function handleDragMove({ bookId, targetStatus, targetCategory, targetIndex }) {
  if (!ensureWritable()) return;
  const before = state.books;
  const nextBooks = moveBook(before, bookId, targetStatus, targetCategory, targetIndex);
  const changed = changedPlacements(before, nextBooks);
  if (!changed.length) return;

  commit({ ...state, books: nextBooks, bookMenuId: null }, { cacheBooks: true });
  if (!repository) return;
  try {
    await repository.saveBookPlacements(changed);
  } catch {
    state = { ...state, books: before };
    writeCachedSnapshot({ books: before, cachedAt: new Date().toISOString() });
    render();
    showToast('Could not sync that move.');
  }
}

function scheduleSearch(value) {
  clearTimeout(searchTimer);
  searchAbortController?.abort();
  const query = String(value ?? '').trim();
  if (query.length < 2) {
    renderSearchResults([]);
    return;
  }
  const requestId = ++searchRequest;
  searchTimer = setTimeout(async () => {
    searchAbortController = new AbortController();
    renderSearchMessage('Searching…');
    try {
      const results = await searchBooks(query, searchAbortController.signal);
      if (requestId !== searchRequest) return;
      searchResults = results;
      renderSearchResults(results);
    } catch {
      if (requestId !== searchRequest) return;
      renderSearchMessage('Search is unavailable. You can still add the book manually.');
    }
  }, 250);
}

function renderSearchResults(results) {
  const region = root.querySelector('[data-region="search-results"]');
  if (!region) return;
  if (!results.length) {
    region.innerHTML = '';
    return;
  }
  region.innerHTML = results.map((item, index) => `<button class="search-result" type="button" data-action="select-search-result" data-result-index="${index}">
    <span class="search-result-title">${escapeText(item.title)}</span>
    <span class="search-result-meta">${escapeText(item.authors[0] ?? '')}${item.firstPublicationYear ? ` · ${escapeText(item.firstPublicationYear)}` : ''}</span>
  </button>`).join('');
}

function renderSearchMessage(message) {
  const region = root.querySelector('[data-region="search-results"]');
  if (region) region.innerHTML = `<p class="search-empty">${escapeText(message)}</p>`;
}

async function selectSearchResult(index) {
  const result = searchResults[index];
  if (!result) return;
  const sheet = root.querySelector('.sheet');
  if (!sheet) return;
  sheet.innerHTML = `<div class="sheet-header"><h2>Add book</h2><button class="icon-button" type="button" data-action="close-sheet" aria-label="Close">${icon('x', { size: 19 })}</button></div><p class="search-empty">Loading book information…</p>`;
  try {
    selectedBook = normalizeBook({
      ...(await hydrateSearchResult(result)),
      status: 'queued',
      category: 'nonfiction',
      sortOrder: nextSortOrder('queued', 'nonfiction'),
    });
    sheet.innerHTML = `<div class="sheet-header"><h2>Add book</h2><button class="icon-button" type="button" data-action="close-sheet" aria-label="Close">${icon('x', { size: 19 })}</button></div>${renderFetchedBookForm(selectedBook)}`;
  } catch {
    selectedBook = normalizeBook({
      title: result.title,
      author: result.authors[0] ?? '',
      publicationYear: result.firstPublicationYear,
      isbn13: result.isbn13Candidates?.[0] ?? null,
      status: 'queued',
      category: 'nonfiction',
      sortOrder: nextSortOrder('queued', 'nonfiction'),
      metadataSource: 'openlibrary',
      metadataSourceId: result.workKey,
    });
    sheet.innerHTML = `<div class="sheet-header"><h2>Add book</h2><button class="icon-button" type="button" data-action="close-sheet" aria-label="Close">${icon('x', { size: 19 })}</button></div>${renderFetchedBookForm(selectedBook)}`;
  }
}

function showManualAddForm() {
  const sheet = root.querySelector('.sheet');
  if (!sheet) return;
  const defaults = normalizeBook({ status: 'queued', category: 'nonfiction' });
  sheet.innerHTML = `<div class="sheet-header"><h2>Add manually</h2><button class="icon-button" type="button" data-action="close-sheet" aria-label="Close">${icon('x', { size: 19 })}</button></div>${renderBookForm(defaults, 'save-manual-book')}`;
}

async function saveFetchedBook() {
  if (!selectedBook || !ensureWritable()) return;
  const placement = readPlacement();
  const book = normalizeBook({
    ...selectedBook,
    ...placement,
    sortOrder: nextSortOrder(placement.status, placement.category),
  });
  await persistNewBook(book);
}

async function saveManualBook() {
  if (!ensureWritable()) return;
  const values = readBookForm();
  if (!values.title || !values.author) {
    showToast('Title and author are required.');
    return;
  }
  const book = normalizeBook({
    ...values,
    metadataSource: 'manual',
    metadataSourceId: null,
    sortOrder: nextSortOrder(values.status, values.category),
  });
  await persistNewBook(book);
}

async function persistNewBook(book) {
  try {
    let saved = book;
    if (repository) saved = await repository.createBook(currentUser.id, book);
    else saved = { ...book, id: crypto.randomUUID?.() ?? `demo-${Date.now()}` };
    state = { ...state, books: [...state.books, saved], sheet: null, editingBookId: null };
    writeCachedSnapshot({ books: state.books, cachedAt: new Date().toISOString() });
    render();
    resetAddState();
    showToast(`${saved.title} added.`);
  } catch {
    showToast('Could not add that book.');
  }
}

async function saveEditBook() {
  if (!ensureWritable()) return;
  const current = state.books.find(book => book.id === state.editingBookId);
  if (!current) return;
  const values = readBookForm();
  if (!values.title || !values.author) {
    showToast('Title and author are required.');
    return;
  }
  const patch = normalizeBook({ ...current, ...values });
  try {
    let saved = patch;
    if (repository) saved = await repository.updateBook(current.id, patch);
    state = {
      ...state,
      books: state.books.map(book => book.id === current.id ? saved : book),
      sheet: null,
      editingBookId: null,
    };
    writeCachedSnapshot({ books: state.books, cachedAt: new Date().toISOString() });
    render();
  } catch {
    showToast('Could not save those changes.');
  }
}

async function moveBookFromMenu(bookId, status, category) {
  if (!ensureWritable()) return;
  const book = state.books.find(item => item.id === bookId);
  if (!book || book.status === 'archived') return;
  const targetStatus = status ?? book.status;
  const targetCategory = category ?? book.category;
  await handleDragMove({
    bookId,
    targetStatus,
    targetCategory,
    targetIndex: state.books.filter(item => item.status === targetStatus && item.category === targetCategory && item.id !== bookId).length,
  });
}

async function finishBook(bookId) {
  if (!ensureWritable()) return;
  const book = state.books.find(item => item.id === bookId);
  if (!book) return;
  const finishedAt = new Date().toISOString();
  try {
    let saved = { ...book, status: 'archived', finishedAt };
    if (repository) saved = await repository.finishBookRecord(bookId, finishedAt);
    state = { ...state, books: state.books.map(item => item.id === bookId ? saved : item), bookMenuId: null };
    writeCachedSnapshot({ books: state.books, cachedAt: finishedAt });
    render();
    showToast(`${book.title} finished.`);
  } catch {
    showToast('Could not archive that book.');
  }
}

async function restoreBook(bookId) {
  if (!ensureWritable()) return;
  const book = state.books.find(item => item.id === bookId);
  if (!book) return;
  const patch = {
    status: 'queued',
    category: book.category,
    sortOrder: nextSortOrder('queued', book.category),
    finishedAt: null,
  };
  try {
    let saved = { ...book, ...patch };
    if (repository) saved = await repository.updateBook(bookId, patch);
    state = { ...state, books: state.books.map(item => item.id === bookId ? saved : item), bookMenuId: null };
    writeCachedSnapshot({ books: state.books, cachedAt: new Date().toISOString() });
    render();
  } catch {
    showToast('Could not restore that book.');
  }
}

async function deleteBook(bookId) {
  if (!ensureWritable()) return;
  const book = state.books.find(item => item.id === bookId);
  if (!book) return;
  if (!confirm(`Delete ${book.title}?`)) return;
  try {
    if (repository) await repository.deleteBook(bookId);
    state = { ...state, books: state.books.filter(item => item.id !== bookId), bookMenuId: null };
    writeCachedSnapshot({ books: state.books, cachedAt: new Date().toISOString() });
    render();
  } catch {
    showToast('Could not delete that book.');
  }
}

async function handleResolvedBookMarksUrl(bookId, url) {
  const book = state.books.find(item => String(item.id) === String(bookId));
  if (!book || book.bookmarksUrl === url) return;
  const updated = { ...book, bookmarksUrl: url };
  state = { ...state, books: state.books.map(item => item.id === book.id ? updated : item) };
  writeCachedSnapshot({ books: state.books, cachedAt: new Date().toISOString() });
  if (repository) {
    try { await repository.saveResolvedBookMarksUrl(book.id, url); } catch {}
  }
}

function readBookForm() {
  const placement = readPlacement();
  return {
    title: fieldValue('book-title'),
    author: fieldValue('book-author'),
    publicationYear: normalizeYear(fieldValue('book-year')),
    isbn13: normalizeIsbn13(fieldValue('book-isbn')),
    description: normalizeDescription(fieldValue('book-description')),
    bookmarksUrl: fieldValue('bookmarks-url') || null,
    amazonCaUrl: fieldValue('amazon-url') || null,
    ...placement,
  };
}

function readPlacement() {
  return {
    status: root.querySelector('[data-field="book-status"]:checked')?.value ?? 'queued',
    category: root.querySelector('[data-field="book-category"]:checked')?.value ?? 'nonfiction',
  };
}

function fieldValue(name) {
  return root.querySelector(`[data-field="${name}"]`)?.value?.trim() ?? '';
}

function nextSortOrder(status, category) {
  const items = state.books.filter(book => book.status === status && book.category === category);
  if (!items.length) return 0;
  return Math.max(...items.map(book => Number(book.sortOrder) || 0)) + 1;
}

function resetAddState() {
  clearTimeout(searchTimer);
  searchAbortController?.abort();
  searchResults = [];
  selectedBook = null;
}

async function handleSignIn() {
  const email = fieldValue('auth-email');
  const password = root.querySelector('[data-field="auth-password"]')?.value || '';
  const button = root.querySelector('[data-action="sign-in"]');
  if (!email || !password) return;
  if (button) { button.disabled = true; button.textContent = 'Signing in…'; }
  try {
    const data = await signIn(email, password);
    await loadCloudUser(data.user);
  } catch {
    root.innerHTML = renderAuthView('Email or password was not accepted.');
  }
}

async function handleSignOut() {
  if (demoMode) {
    dispatch({ type: 'close-menu' });
    showToast('Demo mode — no account is signed in.');
    return;
  }
  try { await signOut(); } catch {}
  clearCriticalReceptionMemoryCache();
  currentUser = null;
  repository = null;
  offlineReadOnly = false;
  clearCachedSnapshot();
  state = { ...state, books: [], menuOpen: false, bookMenuId: null, sheet: null, editingBookId: null, view: 'main' };
  root.innerHTML = renderAuthView();
}

async function loadCloudUser(user) {
  offlineReadOnly = false;
  currentUser = user;
  clearCriticalReceptionMemoryCache();
  const client = await getSupabaseClient();
  if (!client) throw new Error('Cloud sync is not configured.');
  repository = createRepository(client);
  const cached = readCachedSnapshot();
  if (cached?.books) {
    state = { ...state, books: cached.books.map(normalizeBook) };
    render();
  }
  try {
    const books = await repository.loadBooks(user.id);
    state = { ...state, books };
    writeCachedSnapshot({ books, cachedAt: new Date().toISOString() });
    render();
  } catch {
    if (!cached?.books) {
      state = { ...state, books: [] };
      render();
      showToast('Reading database is not ready yet.');
    }
  }
}

async function boot() {
  document.documentElement.dataset.fontScale = state.preferences.fontScale;
  document.documentElement.dataset.theme = state.preferences.themeMode ?? 'system';
  if (demoMode) {
    render();
    return;
  }
  root.innerHTML = '<div class="boot-message">Loading Reading…</div>';
  const cached = readCachedSnapshot();
  if (navigator.onLine === false && cached?.books) {
    offlineReadOnly = true;
    state = { ...state, books: cached.books.map(normalizeBook) };
    render();
    queueMicrotask(() => showToast('Offline — showing last synced data.'));
    return;
  }
  try {
    const user = await getCurrentUser();
    if (!user) {
      root.innerHTML = renderAuthView();
      return;
    }
    await loadCloudUser(user);
  } catch {
    root.innerHTML = renderAuthView('Could not connect. Try again.');
  }
}

function showToast(message) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.append(toast);
  }
  toast.textContent = message;
  toast.classList.add('toast--visible');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('toast--visible'), 2200);
}

function escapeText(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

boot();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }, { once: true });
}
