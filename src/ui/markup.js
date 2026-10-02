import { getPreferredExternalLink } from '../domain/books.js';
import { icon } from './icons.js';

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function renderBookRow(book, { expanded = false, menuOpen = false, archived = false } = {}) {
  const link = getPreferredExternalLink(book);
  const year = book.publicationYear ? escapeHtml(book.publicationYear) : '';
  const metaParts = [];
  if (year) metaParts.push(`<span>${year}</span>`);
  if (link) {
    if (metaParts.length) metaParts.push('<span aria-hidden="true">·</span>');
    metaParts.push(`<a class="book-source-link" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label)} ↗</a>`);
  }
  if (archived && book.finishedAt) {
    if (metaParts.length) metaParts.push('<span aria-hidden="true">·</span>');
    metaParts.push(`<span>Finished ${escapeHtml(formatDate(book.finishedAt))}</span>`);
  }

  const details = expanded ? renderBookDetails(book) : '';
  return `<article class="book-row" data-book-id="${escapeHtml(book.id)}" data-status="${escapeHtml(book.status)}" data-category="${escapeHtml(book.category)}">
    <div class="book-row-main">
      <div class="book-copy">
        <button class="book-title-button" type="button" data-action="toggle-book" data-book-id="${escapeHtml(book.id)}" aria-expanded="${expanded}">
          <span class="book-title">${escapeHtml(book.title)}</span>
          <span class="book-author">${escapeHtml(book.author)}</span>
        </button>
        ${metaParts.length ? `<div class="book-meta">${metaParts.join(' ')}</div>` : ''}
      </div>
      <button class="book-chevron-button" type="button" data-action="toggle-book" data-book-id="${escapeHtml(book.id)}" aria-label="${expanded ? 'Collapse' : 'Expand'} ${escapeHtml(book.title)}">${icon(expanded ? 'chevron-up' : 'chevron-down', { size: 19 })}</button>
      <button class="book-actions-button" type="button" data-action="open-book-menu" data-book-id="${escapeHtml(book.id)}" aria-label="More options for ${escapeHtml(book.title)}" aria-expanded="${menuOpen}">${icon('ellipsis', { size: 21 })}</button>
    </div>
    ${menuOpen ? renderBookActions(book, archived) : ''}
    ${details}
  </article>`;
}

function renderBookDetails(book) {
  const about = book.description
    ? `<section class="book-detail-section"><div class="detail-kicker">ABOUT</div><p class="book-description">${escapeHtml(book.description)}</p></section>`
    : '';
  const critical = `<section class="book-detail-section critical-reception">
    <div class="detail-kicker">CRITICAL RECEPTION</div>
    <div class="critical-reception-content" data-region="critical-reception" data-book-id="${escapeHtml(book.id)}">
      <p class="detail-empty">Loading critical reception…</p>
    </div>
  </section>`;
  return `<div class="book-details">${about}${critical}</div>`;
}

function renderBookActions(book, archived) {
  if (archived) {
    return `<div class="book-actions-scrim" data-action="close-book-menu"></div>
      <div class="book-actions-menu" role="menu" aria-label="${escapeHtml(book.title)} actions">
        <button type="button" role="menuitem" data-action="edit-book" data-book-id="${escapeHtml(book.id)}">Edit</button>
        <button type="button" role="menuitem" data-action="restore-book" data-book-id="${escapeHtml(book.id)}">Restore to Queued Up</button>
        <button class="book-actions-danger" type="button" role="menuitem" data-action="delete-book" data-book-id="${escapeHtml(book.id)}">Delete Book</button>
      </div>`;
  }
  const moveStatusLabel = book.status === 'now_reading' ? 'Move to Queued Up' : 'Move to Now Reading';
  const moveStatus = book.status === 'now_reading' ? 'queued' : 'now_reading';
  const moveCategoryLabel = book.category === 'fiction' ? 'Move to Nonfiction' : 'Move to Fiction';
  const moveCategory = book.category === 'fiction' ? 'nonfiction' : 'fiction';
  return `<div class="book-actions-scrim" data-action="close-book-menu"></div>
    <div class="book-actions-menu" role="menu" aria-label="${escapeHtml(book.title)} actions">
      <button type="button" role="menuitem" data-action="edit-book" data-book-id="${escapeHtml(book.id)}">Edit</button>
      <button type="button" role="menuitem" data-action="move-book-status" data-book-id="${escapeHtml(book.id)}" data-status="${moveStatus}">${moveStatusLabel}</button>
      <button type="button" role="menuitem" data-action="move-book-category" data-book-id="${escapeHtml(book.id)}" data-category="${moveCategory}">${moveCategoryLabel}</button>
      <button type="button" role="menuitem" data-action="finish-book" data-book-id="${escapeHtml(book.id)}">Finished</button>
      <button class="book-actions-danger" type="button" role="menuitem" data-action="delete-book" data-book-id="${escapeHtml(book.id)}">Delete Book</button>
    </div>`;
}

export function renderStatusSection(status, books, preferences, bookMenuId = null) {
  const label = status === 'now_reading' ? 'NOW READING' : 'QUEUED UP';
  const collapsed = status === 'now_reading' ? preferences.nowReadingCollapsed : preferences.queuedCollapsed;
  const categories = preferences.nonfictionFilter ? ['nonfiction'] : ['fiction', 'nonfiction'];
  const contents = collapsed ? '' : categories.map(category =>
    renderCategory(status, category, books.filter(book => book.category === category), preferences, bookMenuId, false)
  ).join('');
  return `<section class="reading-section" data-status="${status}">
    <button class="section-heading" type="button" data-action="toggle-status" data-status="${status}" aria-expanded="${!collapsed}">
      <span>${label}</span>${icon(collapsed ? 'chevron-down' : 'chevron-up', { size: 17 })}
    </button>
    ${contents}
  </section>`;
}

export function renderArchiveCategory(category, books, preferences, bookMenuId = null) {
  return renderCategory('archive', category, books, preferences, bookMenuId, true);
}

function renderCategory(scope, category, books, preferences, bookMenuId, archived) {
  const key = categoryCollapseKey(scope, category);
  const collapsed = Boolean(preferences[key]);
  const label = category === 'fiction' ? 'FICTION' : 'NONFICTION';
  const rows = collapsed ? '' : `<div class="book-list" data-drop-status="${scope}" data-drop-category="${category}">
    ${books.map(book => renderBookRow(book, {
      expanded: (preferences.expandedBookIds ?? []).includes(String(book.id)),
      menuOpen: book.id === bookMenuId,
      archived,
    })).join('')}
    ${books.length ? '' : `<div class="category-empty">No books here.</div>`}
  </div>`;
  return `<div class="category-block" data-category="${category}">
    <button class="category-heading" type="button" data-action="toggle-category" data-scope="${scope}" data-category="${category}" aria-expanded="${!collapsed}">
      <span>${label}</span>${icon(collapsed ? 'chevron-down' : 'chevron-up', { size: 15 })}
    </button>
    ${rows}
  </div>`;
}

function categoryCollapseKey(scope, category) {
  if (scope === 'now_reading') return category === 'fiction' ? 'nowReadingFictionCollapsed' : 'nowReadingNonfictionCollapsed';
  if (scope === 'queued') return category === 'fiction' ? 'queuedFictionCollapsed' : 'queuedNonfictionCollapsed';
  return category === 'fiction' ? 'archiveFictionCollapsed' : 'archiveNonfictionCollapsed';
}

export function formatDate(value) {
  try {
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
  } catch {
    return '';
  }
}
