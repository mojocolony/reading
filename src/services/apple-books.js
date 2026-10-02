import { normalizeDescription, normalizeIsbn13, normalizeYear } from '../domain/books.js';

const SEARCH_URL = 'https://itunes.apple.com/search';
const LOOKUP_URL = 'https://itunes.apple.com/lookup';
const COUNTRY = 'ca';

export class AppleBooksError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'AppleBooksError';
    this.cause = cause;
  }
}

export function normalizeAppleBook(item = {}, requestedIsbn = null) {
  const isbn13 = normalizeIsbn13(requestedIsbn);
  return {
    source: 'applebooks',
    sourceId: item.trackId != null ? String(item.trackId) : null,
    title: String(item.trackName ?? item.collectionName ?? '').trim(),
    authors: String(item.artistName ?? '').trim() ? [String(item.artistName).trim()] : [],
    firstPublicationYear: normalizeYear(String(item.releaseDate ?? '').slice(0, 4)),
    isbn13Candidates: isbn13 ? [isbn13] : [],
    isbn10Candidates: [],
    description: normalizeDescription(item.description),
    appleBooksUrl: String(item.trackViewUrl ?? '').trim() || null,
  };
}

export async function searchAppleBooks(query, signal) {
  const q = String(query ?? '').trim();
  if (q.length < 2) return [];
  const compact = q.replace(/[^0-9Xx]/g, '');
  const isIsbn13 = /^\d{13}$/.test(compact);

  const params = new URLSearchParams({ country: COUNTRY });
  let url;
  if (isIsbn13) {
    params.set('isbn', compact);
    url = `${LOOKUP_URL}?${params}`;
  } else {
    params.set('term', q);
    params.set('media', 'ebook');
    params.set('entity', 'ebook');
    params.set('limit', '20');
    url = `${SEARCH_URL}?${params}`;
  }

  let response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    throw new AppleBooksError('Could not search Apple Books.', error);
  }
  if (!response.ok) throw new AppleBooksError(`Apple Books search failed (${response.status}).`);

  const payload = await response.json();
  return (payload.results ?? [])
    .map(item => normalizeAppleBook(item, isIsbn13 ? compact : null))
    .filter(item => item.sourceId && item.title && item.authors.length);
}

export function hydrateAppleResult(result) {
  const isbn13 = result?.isbn13Candidates?.[0] ?? null;
  return {
    title: result.title,
    author: result.authors?.[0] ?? '',
    publicationYear: result.firstPublicationYear ?? null,
    isbn13,
    description: result.description ?? null,
    metadataSource: 'applebooks',
    metadataSourceId: result.sourceId,
    amazonCaUrl: buildAmazonCaUrl(result, isbn13),
  };
}

function buildAmazonCaUrl(result, isbn13) {
  const query = isbn13 || [result?.title, result?.authors?.[0]].filter(Boolean).join(' ');
  return query ? `https://www.amazon.ca/s?k=${encodeURIComponent(query)}` : null;
}
