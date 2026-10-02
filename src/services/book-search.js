import { hydrateAppleResult, searchAppleBooks } from './apple-books.js';
import { hydrateGoogleResult, searchGoogleBooks } from './google-books.js';
import { hydrateSearchResult as hydrateOpenLibraryResult, searchBooks as searchOpenLibraryBooks } from './open-library.js';

const MIN_RESULT_SCORE = 0.55;

export async function searchBooks(query, signal) {
  const q = String(query ?? '').trim();
  if (q.length < 2) return [];

  const providers = [
    () => searchAppleBooks(q, signal),
    () => searchGoogleBooks(q, signal),
    () => searchOpenLibraryBooks(q, signal),
  ];

  const settled = await Promise.all(providers.map(async provider => {
    try {
      return { ok: true, results: await provider() };
    } catch (error) {
      if (signal?.aborted) throw error;
      return { ok: false, results: [] };
    }
  }));

  const available = settled.flatMap(item => item.results);
  if (!available.length && settled.every(item => !item.ok)) {
    throw new Error('Book search is unavailable.');
  }

  return rankResults(q, mergeResults(...settled.map(item => item.results)))
    .filter(result => relevanceScore(q, result) >= MIN_RESULT_SCORE)
    .slice(0, 16);
}

export async function hydrateSearchResult(result, signal) {
  if (result?.source === 'applebooks') return hydrateAppleResult(result);
  if (result?.source === 'googlebooks') return hydrateGoogleResult(result);
  return hydrateOpenLibraryResult(result, signal);
}

export function mergeResults(...groups) {
  const merged = [];
  for (const result of groups.flat()) {
    const matchIndex = merged.findIndex(existing => sameBook(existing, result));
    if (matchIndex === -1) {
      merged.push(cloneResult(result));
      continue;
    }
    merged[matchIndex] = enrichResult(merged[matchIndex], result);
  }
  return merged;
}

export function rankResults(query, results = []) {
  return results
    .map((result, index) => ({ result, index, score: relevanceScore(query, result) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(item => item.result);
}

export function relevanceScore(query, result) {
  const q = normalizeText(query);
  if (!q) return 0;

  const isbn = normalizeIsbnQuery(query);
  if (isbn) {
    const identifiers = [
      ...(result?.isbn13Candidates ?? []),
      ...(result?.isbn10Candidates ?? []),
    ].map(value => String(value).replace(/[^0-9Xx]/g, '').toLowerCase());
    return identifiers.includes(isbn.toLowerCase()) ? 3 : 0;
  }

  const title = normalizeText(result?.title);
  const author = normalizeText((result?.authors ?? []).join(' '));
  const queryWords = words(q);
  const titleWords = new Set(words(title));
  const authorWords = new Set(words(author));
  if (!queryWords.length) return 0;

  let score = 0;
  if (title === q) score += 1.4;
  else if (title.startsWith(q)) score += 0.9;

  const titleHits = queryWords.filter(token => titleWords.has(token)).length;
  const authorHits = queryWords.filter(token => authorWords.has(token)).length;
  score += (titleHits / queryWords.length) * 0.7;
  score += (authorHits / queryWords.length) * 0.65;
  if (titleHits && authorHits) score += 0.3;

  const first = queryWords[0];
  const last = queryWords.at(-1);
  const titleFirst = words(title)[0];
  if (queryWords.length >= 2 && first === titleFirst && authorWords.has(last)) score += 0.85;

  return score;
}

function sameBook(a, b) {
  const aIsbns = new Set(a?.isbn13Candidates ?? []);
  if ((b?.isbn13Candidates ?? []).some(isbn => aIsbns.has(isbn))) return true;
  return normalizeText(a?.title) === normalizeText(b?.title)
    && normalizeText(a?.authors?.[0]) === normalizeText(b?.authors?.[0]);
}

function enrichResult(primary, secondary) {
  return {
    ...primary,
    title: preferredTitle(primary.title, secondary.title),
    authors: primary.authors?.length ? primary.authors : secondary.authors,
    firstPublicationYear: primary.firstPublicationYear ?? secondary.firstPublicationYear ?? null,
    isbn13Candidates: unique([...(primary.isbn13Candidates ?? []), ...(secondary.isbn13Candidates ?? [])]),
    isbn10Candidates: unique([...(primary.isbn10Candidates ?? []), ...(secondary.isbn10Candidates ?? [])]),
    description: primary.description ?? secondary.description ?? null,
    amazonIds: unique([...(primary.amazonIds ?? []), ...(secondary.amazonIds ?? [])]),
    appleBooksUrl: primary.appleBooksUrl ?? secondary.appleBooksUrl ?? null,
  };
}

function cloneResult(result) {
  return {
    ...result,
    authors: [...(result.authors ?? [])],
    isbn13Candidates: [...(result.isbn13Candidates ?? [])],
    isbn10Candidates: [...(result.isbn10Candidates ?? [])],
    amazonIds: [...(result.amazonIds ?? [])],
  };
}

function preferredTitle(a, b) {
  const left = String(a ?? '').trim();
  const right = String(b ?? '').trim();
  if (!left) return right;
  if (!right) return left;
  const leftStartsRight = normalizeText(left).startsWith(normalizeText(right));
  const rightStartsLeft = normalizeText(right).startsWith(normalizeText(left));
  if (leftStartsRight && left.length >= right.length) return left;
  if (rightStartsLeft && right.length >= left.length) return right;
  return left;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function words(value) {
  return normalizeText(value).split(' ').filter(token => token.length > 1);
}

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeIsbnQuery(value) {
  const compact = String(value ?? '').replace(/[^0-9Xx]/g, '');
  if (/^\d{13}$/.test(compact) || /^\d{9}[\dXx]$/.test(compact)) return compact;
  return null;
}
