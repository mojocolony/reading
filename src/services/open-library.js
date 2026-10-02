import { normalizeDescription, normalizeIsbn13, normalizeYear } from '../domain/books.js';

const SEARCH_URL = 'https://openlibrary.org/search.json';
const WORK_BASE = 'https://openlibrary.org';

export class OpenLibraryError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'OpenLibraryError';
    this.cause = cause;
  }
}

export function normalizeSearchDoc(doc = {}) {
  const workKey = normalizeWorkKey(doc.key);
  const isbns = [...new Set((doc.isbn ?? []).map(normalizeIsbn13).filter(Boolean))].sort();
  const isbn10s = [...new Set((doc.isbn ?? []).map(value => String(value ?? '').replace(/[^0-9Xx]/g, '')).filter(value => /^\d{9}[\dXx]$/.test(value)))].sort();
  const amazonIds = [...new Set((doc.id_amazon ?? []).map(String).map(v => v.trim()).filter(Boolean))];

  return {
    source: 'openlibrary',
    sourceId: workKey,
    workKey,
    title: String(doc.title ?? '').trim(),
    authors: Array.isArray(doc.author_name) ? doc.author_name.map(String).map(v => v.trim()).filter(Boolean) : [],
    firstPublicationYear: normalizeYear(doc.first_publish_year),
    isbn13Candidates: isbns,
    isbn10Candidates: isbn10s,
    amazonIds,
  };
}

export function chooseIsbn13(result) {
  return result?.isbn13Candidates?.[0] ?? null;
}

export function buildAmazonCaUrl(result, isbn13 = chooseIsbn13(result)) {
  const amazonId = result?.amazonIds?.[0];
  if (amazonId) return `https://www.amazon.ca/dp/${encodeURIComponent(amazonId)}`;
  const isbn10 = result?.isbn10Candidates?.[0];
  if (isbn10) return `https://www.amazon.ca/dp/${encodeURIComponent(isbn10)}`;
  const query = isbn13 || [result?.title, result?.authors?.[0]].filter(Boolean).join(' ');
  if (!query) return null;
  return `https://www.amazon.ca/s?k=${encodeURIComponent(query)}`;
}

export async function searchBooks(query, signal) {
  const q = String(query ?? '').trim();
  if (q.length < 2) return [];
  const compact = q.replace(/[^0-9Xx]/g, '');
  const isIsbn = /^\d{13}$/.test(compact) || /^\d{9}[\dXx]$/.test(compact);
  const params = new URLSearchParams({
    limit: '12',
    fields: 'key,title,author_name,first_publish_year,isbn,id_amazon',
  });
  params.set(isIsbn ? 'isbn' : 'q', isIsbn ? compact : q);
  let response;
  try {
    response = await fetch(`${SEARCH_URL}?${params}`, { signal });
  } catch (error) {
    throw new OpenLibraryError('Could not search Open Library.', error);
  }
  if (!response.ok) throw new OpenLibraryError(`Open Library search failed (${response.status}).`);
  const payload = await response.json();
  const seen = new Set();
  return (payload.docs ?? [])
    .map(normalizeSearchDoc)
    .filter(item => item.workKey && item.title && item.authors.length)
    .filter(item => {
      if (seen.has(item.workKey)) return false;
      seen.add(item.workKey);
      return true;
    });
}

export async function getWorkDescription(workKey, signal) {
  const key = normalizeWorkKey(workKey);
  if (!key) return null;
  let response;
  try {
    response = await fetch(`${WORK_BASE}${key}.json`, { signal });
  } catch (error) {
    throw new OpenLibraryError('Could not load the book description.', error);
  }
  if (!response.ok) {
    if (response.status === 404) return null;
    throw new OpenLibraryError(`Open Library work lookup failed (${response.status}).`);
  }
  const payload = await response.json();
  return normalizeDescription(payload.description);
}

export async function hydrateSearchResult(result, signal) {
  const description = await getWorkDescription(result.workKey, signal).catch(() => null);
  const isbn13 = chooseIsbn13(result);
  return {
    title: result.title,
    author: result.authors[0] ?? '',
    publicationYear: result.firstPublicationYear,
    isbn13,
    description,
    metadataSource: 'openlibrary',
    metadataSourceId: result.workKey,
    amazonCaUrl: buildAmazonCaUrl(result, isbn13),
  };
}

function normalizeWorkKey(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (/^\/works\/OL\d+W$/i.test(raw)) return raw;
  if (/^OL\d+W$/i.test(raw)) return `/works/${raw}`;
  return null;
}
