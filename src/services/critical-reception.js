import { getSupabaseClient } from './supabase.js';

const memoryCache = new Map();
const pending = new Map();
let cacheGeneration = 0;

export async function refreshCriticalReception(root, books, onResolvedBookMarksUrl = () => {}, options = {}) {
  const regions = [...root.querySelectorAll?.('[data-region="critical-reception"][data-book-id]') ?? []];
  for (const region of regions) {
    const bookId = String(region.dataset.bookId ?? '');
    const book = books.find(item => String(item.id) === bookId);
    if (!book) continue;

    if (!/^[0-9a-f-]{36}$/i.test(bookId)) {
      renderReception(region, { reviews: [], source: null, sourceUrl: null });
      continue;
    }

    const identity = JSON.stringify([bookId, book.title ?? '', book.author ?? '', book.isbn13 ?? '', book.bookmarksUrl ?? '']);
    const generation = cacheGeneration;
    region.dataset.receptionKey = identity;
    const refresh = () => refreshCriticalReception(root, [book], onResolvedBookMarksUrl, { force: true });
    const cached = memoryCache.get(identity);
    if (!options.force && cached && Date.now() < cached.expiresAt) {
      renderReception(region, cached.result, refresh);
      continue;
    }

    if (!pending.has(identity)) {
      pending.set(identity, loadReception(bookId, Boolean(options.force))
        .then(result => {
          const current = root.querySelector(`[data-region="critical-reception"][data-book-id="${cssEscape(bookId)}"]`);
          if (generation !== cacheGeneration) return result;
          if (result?.reviews?.length) memoryCache.set(identity, { result, expiresAt: Number.isFinite(Date.parse(result.expiresAt)) ? Date.parse(result.expiresAt) : Date.now() + (result.incomplete || result.stale ? 24 : 7 * 24) * 60 * 60 * 1000 });
          if (current?.dataset.receptionKey === identity && result?.source === 'bookmarks' && result?.sourceUrl) {
            onResolvedBookMarksUrl(bookId, result.sourceUrl);
          }
          return result;
        })
        .catch(() => cached?.result?.reviews?.length ? { ...cached.result, stale: true, incomplete: true } : { reviews: [], source: null, sourceUrl: null, error: true })
        .finally(() => { if (generation === cacheGeneration) pending.delete(identity); }));
    }

    const result = await pending.get(identity);
    const currentRegion = root.querySelector(`[data-region="critical-reception"][data-book-id="${cssEscape(bookId)}"]`);
    if (generation === cacheGeneration && currentRegion?.dataset.receptionKey === identity) renderReception(currentRegion, result, refresh);
  }
}

async function loadReception(bookId, force = false) {
  const client = await getSupabaseClient();
  if (!client) return { reviews: [], source: null, sourceUrl: null, error: true };

  const { data, error } = await client.functions.invoke('reading-reception', {
    body: { bookId, force },
  });
  if (error) throw error;
  return {
    reviews: Array.isArray(data?.reviews) ? data.reviews.slice(0, 3).map(review => ({ ...review, kind: review.kind ?? (data.source === 'publisher' ? 'publisher-praise' : 'excerpt') })) : [],
    source: data?.source ?? null,
    sourceUrl: validHttpUrl(data?.sourceUrl),
    incomplete: Boolean(data?.incomplete),
    stale: Boolean(data?.stale),
    expiresAt: data?.expiresAt ?? null,
  };
}

function renderReception(region, result, onRefresh) {
  region.replaceChildren();
  const reviews = Array.isArray(result?.reviews) ? result.reviews : [];

  if (!reviews.length) {
    const empty = document.createElement('p');
    empty.className = 'detail-empty';
    empty.textContent = result?.error
      ? 'Critical reception is unavailable right now.'
      : 'No critical reception found yet.';
    region.append(empty);
    appendRefresh(region, onRefresh);
    return;
  }

  for (const review of reviews) {
    const item = document.createElement('div');
    item.className = 'critical-review';

    const meta = document.createElement('div');
    meta.className = 'critical-review-meta';
    meta.textContent = formatMeta(review);

    const excerpt = document.createElement('p');
    excerpt.className = 'critical-review-excerpt';
    excerpt.textContent = `“${String(review?.excerpt ?? '').trim()}”`;

    item.append(meta, excerpt);
    const reviewUrl = validHttpUrl(review?.url);
    if (reviewUrl) {
      const link = document.createElement('a');
      link.className = 'critical-reception-source';
      link.href = reviewUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = review.kind === 'publisher-praise' ? 'Publisher source ↗' : new URL(reviewUrl).hostname.endsWith('bookmarks.reviews') ? 'Book Marks ↗' : 'Read review ↗';
      item.append(link);
    }
    region.append(item);
  }

  if (result?.sourceUrl && result.source !== 'reviews' && !reviews.every(review => validHttpUrl(review.url))) {
    const link = document.createElement('a');
    link.className = 'critical-reception-source';
    link.href = result.sourceUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = result.source === 'bookmarks' ? 'Book Marks ↗' : 'Publisher source ↗';
    region.append(link);
  }
  if (result.stale || result.incomplete) {
    const status = document.createElement('p');
    status.className = 'critical-reception-status';
    status.textContent = result.stale ? 'Sources were unavailable. Showing saved reviews.' : 'Showing the verified sources found so far. Refresh to try again.';
    region.append(status);
  }
  appendRefresh(region, onRefresh);
}

function appendRefresh(region, onRefresh) {
  if (!onRefresh) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'critical-reception-refresh';
  button.textContent = 'Refresh reviews';
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Refreshing…';
    try { await onRefresh(); }
    finally { button.disabled = false; button.textContent = 'Refresh reviews'; }
  });
  region.append(button);
}

function formatMeta(review) {
  const parts = [];
  if (review?.kind === 'publisher-praise') parts.push('Publisher-selected praise');
  if (review?.rating) parts.push(String(review.rating));
  const credit = [review?.reviewer, review?.outlet].filter(Boolean).join(', ');
  if (credit) parts.push(credit);
  return parts.join(' · ');
}

function validHttpUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function cssEscape(value) {
  return globalThis.CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/["\\]/g, '\\$&');
}

export function clearCriticalReceptionMemoryCache() {
  cacheGeneration += 1;
  memoryCache.clear();
  pending.clear();
}
