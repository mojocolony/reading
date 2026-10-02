import { APP_VERSION } from '../config.js';
import { escapeHtml, renderArchiveCategory, renderStatusSection } from './markup.js';
import { icon } from './icons.js';

function renderMenu(state) {
  if (!state.menuOpen) return '';
  const scale = state.preferences.fontScale;
  return `<div class="menu-scrim" data-action="close-menu"></div>
    <aside class="menu-panel" aria-label="Menu">
      <button class="menu-item" type="button" data-action="open-archive">Archive</button>
      <div class="menu-control-row" aria-label="Font size">
        <span class="menu-label">Font size</span>
        <div class="font-size-controls">
          <button type="button" data-action="set-font-scale" data-font-scale="small" aria-pressed="${scale === 'small'}">A−</button>
          <button type="button" data-action="set-font-scale" data-font-scale="medium" aria-pressed="${scale === 'medium'}">A</button>
          <button type="button" data-action="set-font-scale" data-font-scale="large" aria-pressed="${scale === 'large'}">A+</button>
        </div>
      </div>
      <div class="menu-control-row" aria-label="Theme">
        <span class="menu-label">Theme</span>
        <div class="theme-controls">
          <button type="button" data-action="set-theme-mode" data-theme-mode="system" aria-pressed="${state.preferences.themeMode === 'system'}">System</button>
          <button type="button" data-action="set-theme-mode" data-theme-mode="light" aria-pressed="${state.preferences.themeMode === 'light'}">Light</button>
          <button type="button" data-action="set-theme-mode" data-theme-mode="dark" aria-pressed="${state.preferences.themeMode === 'dark'}">Dark</button>
        </div>
      </div>
      <button class="menu-item" type="button" data-action="sign-out">Sign out</button>
      <div class="menu-version">v${APP_VERSION}</div>
    </aside>`;
}

function renderAddSheet() {
  return `<div class="sheet-scrim" data-action="close-sheet"></div>
    <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="add-book-title">
      <div class="sheet-header">
        <h2 id="add-book-title">Add book</h2>
        <button class="icon-button" type="button" data-action="close-sheet" aria-label="Close">${icon('x', { size: 19 })}</button>
      </div>
      <label class="field-label" for="book-search">Search books</label>
      <input id="book-search" class="text-field" type="search" autocomplete="off" placeholder="Start typing a title…" data-field="book-search">
      <div class="search-results" data-region="search-results" aria-live="polite"></div>
      <button class="manual-link" type="button" data-action="start-manual-add">Add manually</button>
    </section>`;
}

function renderEditSheet(state) {
  const book = state.books.find(item => item.id === state.editingBookId);
  if (!book) return '';
  return `<div class="sheet-scrim" data-action="close-sheet"></div>
    <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="edit-book-title">
      <div class="sheet-header">
        <h2 id="edit-book-title">Edit book</h2>
        <button class="icon-button" type="button" data-action="close-sheet" aria-label="Close">${icon('x', { size: 19 })}</button>
      </div>
      ${renderBookForm(book, 'save-edit-book')}
    </section>`;
}

export function renderBookForm(book = {}, action = 'save-manual-book') {
  return `<label class="field-label">Title</label>
    <input class="text-field" data-field="book-title" value="${escapeHtml(book.title ?? '')}">
    <label class="field-label">Author</label>
    <input class="text-field" data-field="book-author" value="${escapeHtml(book.author ?? '')}">
    <div class="field-grid">
      <div><label class="field-label">First publication year</label><input class="text-field compact-field" inputmode="numeric" data-field="book-year" value="${escapeHtml(book.publicationYear ?? '')}"></div>
      <div><label class="field-label">ISBN-13</label><input class="text-field compact-field" inputmode="numeric" data-field="book-isbn" value="${escapeHtml(book.isbn13 ?? '')}"></div>
    </div>
    <label class="field-label">Description</label>
    <textarea class="text-field text-area" data-field="book-description">${escapeHtml(book.description ?? '')}</textarea>
    <label class="field-label">Book Marks URL</label>
    <input class="text-field" type="url" data-field="bookmarks-url" value="${escapeHtml(book.bookmarksUrl ?? '')}" placeholder="Optional">
    <label class="field-label">Amazon.ca URL</label>
    <input class="text-field" type="url" data-field="amazon-url" value="${escapeHtml(book.amazonCaUrl ?? '')}" placeholder="Optional">
    ${renderPlacementChoices(book)}
    <button class="primary-button" type="button" data-action="${action}">${action === 'save-edit-book' ? 'Save changes' : 'Add book'}</button>`;
}

export function renderFetchedBookForm(book) {
  return `<div class="selected-book">
      <div class="selected-title">${escapeHtml(book.title)}</div>
      <div class="selected-author">${escapeHtml(book.author)}</div>
      <div class="selected-meta">${book.publicationYear ? escapeHtml(book.publicationYear) : 'Year unavailable'}${book.isbn13 ? ` · ISBN ${escapeHtml(book.isbn13)}` : ''}</div>
    </div>
    ${book.description ? `<p class="selected-description">${escapeHtml(book.description)}</p>` : '<p class="selected-description selected-description--muted">No description found. The book can still be added.</p>'}
    ${renderPlacementChoices(book)}
    <button class="primary-button" type="button" data-action="save-fetched-book">Add book</button>`;
}

function renderPlacementChoices(book = {}) {
  const status = book.status ?? 'queued';
  const category = book.category ?? 'nonfiction';
  return `<fieldset class="choice-group">
      <legend>List</legend>
      <label><input type="radio" name="status" value="now_reading" data-field="book-status" ${status === 'now_reading' ? 'checked' : ''}> Now Reading</label>
      <label><input type="radio" name="status" value="queued" data-field="book-status" ${status === 'queued' ? 'checked' : ''}> Queued Up</label>
    </fieldset>
    <fieldset class="choice-group">
      <legend>Category</legend>
      <label><input type="radio" name="category" value="fiction" data-field="book-category" ${category === 'fiction' ? 'checked' : ''}> Fiction</label>
      <label><input type="radio" name="category" value="nonfiction" data-field="book-category" ${category === 'nonfiction' ? 'checked' : ''}> Nonfiction</label>
    </fieldset>`;
}

function renderArchive(state) {
  const archived = state.books.filter(book => book.status === 'archived');
  const categories = state.preferences.nonfictionFilter ? ['nonfiction'] : ['fiction', 'nonfiction'];
  return `<main class="archive-view">
    <div class="archive-header">
      <button class="icon-button" type="button" data-action="close-archive" aria-label="Back">${icon('arrow-left', { size: 20 })}</button>
      <h1>Archive</h1>
    </div>
    ${categories.map(category => renderArchiveCategory(
      category,
      archived.filter(book => book.category === category).sort((a, b) => new Date(b.finishedAt ?? 0) - new Date(a.finishedAt ?? 0)),
      state.preferences,
      state.bookMenuId,
    )).join('')}
  </main>`;
}

export function renderAppMarkup(state) {
  const filtered = state.preferences.nonfictionFilter
    ? state.books.filter(book => book.category === 'nonfiction' || book.status === 'archived')
    : state.books;
  const active = filtered.filter(book => book.status !== 'archived');
  const nowReading = active.filter(book => book.status === 'now_reading').sort((a, b) => a.sortOrder - b.sortOrder);
  const queued = active.filter(book => book.status === 'queued').sort((a, b) => a.sortOrder - b.sortOrder);

  const main = state.view === 'archive'
    ? renderArchive(state)
    : `<main class="main-view">
        ${renderStatusSection('now_reading', nowReading, state.preferences, state.bookMenuId)}
        ${renderStatusSection('queued', queued, state.preferences, state.bookMenuId)}
      </main>`;

  const filterActive = state.preferences.nonfictionFilter;
  return `<div class="reading-app" data-font-scale="${escapeHtml(state.preferences.fontScale)}" data-theme-mode="${escapeHtml(state.preferences.themeMode ?? 'system')}">
    <header class="app-header">
      <div class="brand"><span class="brand-icon">${icon('book-open-text', { size: 21 })}</span><span>Reading</span></div>
      <button class="icon-button menu-button" type="button" data-action="open-menu" aria-label="Open menu">${icon('hamburger', { size: 22 })}</button>
    </header>
    ${main}
    <div class="floating-pill" aria-label="Quick actions">
      <button class="floating-button" type="button" data-action="add-book" aria-label="Add book">${icon('plus', { size: 24 })}</button>
      <span class="floating-divider"></span>
      <button class="floating-button${filterActive ? ' floating-button--active' : ''}" type="button" data-action="toggle-nonfiction-filter" aria-label="${filterActive ? 'Show fiction and nonfiction' : 'Show nonfiction only'}" aria-pressed="${filterActive}">${icon('brain', { size: 22 })}</button>
    </div>
    ${renderMenu(state)}
    ${state.sheet === 'add' ? renderAddSheet() : ''}
    ${state.sheet === 'edit' ? renderEditSheet(state) : ''}
  </div>`;
}
