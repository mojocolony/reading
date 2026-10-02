const VALID_STATUSES = new Set(['now_reading', 'queued', 'archived']);
const VALID_CATEGORIES = new Set(['fiction', 'nonfiction']);

export function normalizeBook(raw = {}) {
  return {
    id: raw.id ?? null,
    userId: raw.userId ?? null,
    title: String(raw.title ?? '').trim(),
    author: String(raw.author ?? '').trim(),
    publicationYear: normalizeYear(raw.publicationYear),
    isbn13: normalizeIsbn13(raw.isbn13),
    status: VALID_STATUSES.has(raw.status) ? raw.status : 'queued',
    category: VALID_CATEGORIES.has(raw.category) ? raw.category : 'nonfiction',
    sortOrder: Number.isFinite(Number(raw.sortOrder)) ? Number(raw.sortOrder) : 0,
    description: normalizeDescription(raw.description),
    metadataSource: raw.metadataSource ?? 'manual',
    metadataSourceId: raw.metadataSourceId ?? null,
    bookmarksUrl: validHttpUrl(raw.bookmarksUrl),
    amazonCaUrl: validHttpUrl(raw.amazonCaUrl),
    finishedAt: raw.finishedAt ?? null,
    createdAt: raw.createdAt ?? null,
    updatedAt: raw.updatedAt ?? null,
  };
}

export function getPreferredExternalLink(book) {
  const bookmarksUrl = validHttpUrl(book?.bookmarksUrl);
  if (bookmarksUrl) return { label: 'Book Marks', url: bookmarksUrl };
  const amazonCaUrl = validHttpUrl(book?.amazonCaUrl);
  if (amazonCaUrl) return { label: 'Amazon.ca', url: amazonCaUrl };
  return null;
}

export function finishBook(book, finishedAt = new Date().toISOString()) {
  return {
    ...book,
    status: 'archived',
    finishedAt,
  };
}

export function normalizeIsbn13(value) {
  const digits = String(value ?? '').replace(/[^0-9Xx]/g, '');
  if (!/^\d{13}$/.test(digits)) return null;
  return digits;
}

export function normalizeYear(value) {
  if (value == null || value === '') return null;
  const year = Number.parseInt(value, 10);
  return Number.isFinite(year) && year > 0 && year < 10000 ? year : null;
}

export function normalizeDescription(value) {
  if (value == null) return null;
  const text = typeof value === 'object' && value && 'value' in value ? value.value : value;
  const stripped = String(text)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped || null;
}

function validHttpUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}
