import { normalizeDescription, normalizeIsbn13, normalizeYear } from '../domain/books.js';

const SEARCH_URL = 'https://www.googleapis.com/books/v1/volumes';

export class GoogleBooksError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'GoogleBooksError';
    this.cause = cause;
  }
}

export function normalizeGoogleVolume(item = {}) {
  const info = item.volumeInfo ?? {};
  const identifiers = Array.isArray(info.industryIdentifiers) ? info.industryIdentifiers : [];
  const isbn13Candidates = identifiers
    .filter(identifier => identifier?.type === 'ISBN_13')
    .map(identifier => normalizeIsbn13(identifier.identifier))
    .filter(Boolean);
  const isbn10Candidates = identifiers
    .filter(identifier => identifier?.type === 'ISBN_10')
    .map(identifier => String(identifier.identifier ?? '').replace(/[^0-9Xx]/g, ''))
    .filter(value => /^\d{9}[\dXx]$/.test(value));

  return {
    source: 'googlebooks',
    sourceId: String(item.id ?? '').trim() || null,
    title: String(info.title ?? '').trim(),
    authors: Array.isArray(info.authors) ? info.authors.map(String).map(v => v.trim()).filter(Boolean) : [],
    firstPublicationYear: normalizeYear(String(info.publishedDate ?? '').slice(0, 4)),
    isbn13Candidates: [...new Set(isbn13Candidates)].sort(),
    isbn10Candidates: [...new Set(isbn10Candidates)].sort(),
    description: normalizeDescription(info.description),
  };
}

export async function searchGoogleBooks(query, signal) {
  const q = String(query ?? '').trim();
  if (q.length < 2) return [];
  const compact = q.replace(/[^0-9Xx]/g, '');
  const isIsbn = /^\d{13}$/.test(compact) || /^\d{9}[\dXx]$/.test(compact);
  const params = new URLSearchParams({
    q: isIsbn ? `isbn:${compact}` : q,
    maxResults: '12',
    orderBy: 'relevance',
    printType: 'books',
    projection: 'full',
  });

  let response;
  try {
    response = await fetch(`${SEARCH_URL}?${params}`, { signal });
  } catch (error) {
    throw new GoogleBooksError('Could not search Google Books.', error);
  }
  if (!response.ok) throw new GoogleBooksError(`Google Books search failed (${response.status}).`);
  const payload = await response.json();
  return (payload.items ?? [])
    .map(normalizeGoogleVolume)
    .filter(item => item.sourceId && item.title && item.authors.length);
}

export function hydrateGoogleResult(result) {
  const isbn13 = result?.isbn13Candidates?.[0] ?? null;
  return {
    title: result.title,
    author: result.authors?.[0] ?? '',
    publicationYear: result.firstPublicationYear ?? null,
    isbn13,
    description: result.description ?? null,
    metadataSource: 'googlebooks',
    metadataSourceId: result.sourceId,
    amazonCaUrl: buildAmazonCaUrl(result, isbn13),
  };
}

function buildAmazonCaUrl(result, isbn13) {
  const query = isbn13 || [result?.title, result?.authors?.[0]].filter(Boolean).join(' ');
  return query ? `https://www.amazon.ca/s?k=${encodeURIComponent(query)}` : null;
}
