import { getSupabaseClient } from './supabase.js';

const memoryCache = new Map();
const pending = new Map();

export async function refreshCriticalReception(root, books, onResolvedBookMarksUrl = () => {}) {
  const regions = [...root.querySelectorAll?.('[data-region="critical-reception"][data-book-id]') ?? []];
  for (const region of regions) {
    const bookId = String(region.dataset.bookId ?? '');
    const book = books.find(item => String(item.id) === bookId);
    if (!book) continue;

    if (!/^[0-9a-f-]{36}$/i.test(bookId)) {
      renderReception(region, { reviews: [], source: null, sourceUrl: null });
      continue;
    }

    const cached = memoryCache.get(bookId);
    if (cached) {
      renderReception(region, cached);
      continue;
    }

    if (!pending.has(bookId)) {
      pending.set(bookId, loadReception(bookId)
        .then(result => {
          memoryCache.set(bookId, result);
          if (result?.source === 'bookmarks' && result?.sourceUrl) {
            onResolvedBookMarksUrl(bookId, result.sourceUrl);
          }
          return result;
        })
        .catch(() => ({ reviews: [], source: null, sourceUrl: null, error: true }))
        .finally(() => pending.delete(bookId)));
    }

    const result = await pending.get(bookId);
    const currentRegion = root.querySelector(`[data-region="critical-reception"][data-book-id="${cssEscape(bookId)}"]`);
    if (currentRegion) renderReception(currentRegion, result);
  }
}

async function loadReception(bookId) {
  const client = await getSupabaseClient();
  if (!client) return { reviews: [], source: null, sourceUrl: null, error: true };

  const { data, error } = await client.functions.invoke('reading-reception', {
    body: { bookId },
  });
  if (error) throw error;
  return {
    reviews: Array.isArray(data?.reviews) ? data.reviews.slice(0, 3) : [],
    source: data?.source ?? null,
    sourceUrl: validHttpUrl(data?.sourceUrl),
  };
}

function renderReception(region, result) {
  region.replaceChildren();
  const reviews = Array.isArray(result?.reviews) ? result.reviews : [];

  if (!reviews.length) {
    const empty = document.createElement('p');
    empty.className = 'detail-empty';
    empty.textContent = result?.error
      ? 'Critical reception is unavailable right now.'
      : 'No critical reception found yet.';
    region.append(empty);
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
    region.append(item);
  }

  if (result?.sourceUrl) {
    const link = document.createElement('a');
    link.className = 'critical-reception-source';
    link.href = result.sourceUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = result.source === 'bookmarks' ? 'Book Marks ↗' : 'Publisher source ↗';
    region.append(link);
  }
}

function formatMeta(review) {
  const parts = [];
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
  memoryCache.clear();
}
