import { hydrateSearchResult as hydrateOpenLibraryResult, searchBooks as searchOpenLibraryBooks } from './open-library.js';
import { hydrateGoogleResult, searchGoogleBooks } from './google-books.js';

export async function searchBooks(query, signal) {
  const q = String(query ?? '').trim();
  if (q.length < 2) return [];

  let openLibraryResults = [];
  let openLibraryFailed = false;
  try {
    openLibraryResults = await searchOpenLibraryBooks(q, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    openLibraryFailed = true;
  }

  const useGoogle = openLibraryFailed || shouldUseGoogleFallback(q, openLibraryResults);
  if (!useGoogle) return rankResults(q, openLibraryResults).slice(0, 12);

  let googleResults = [];
  try {
    googleResults = await searchGoogleBooks(q, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    if (!openLibraryResults.length) throw error;
  }

  return rankResults(q, mergeResults(openLibraryResults, googleResults)).slice(0, 16);
}

export async function hydrateSearchResult(result, signal) {
  return result?.source === 'googlebooks'
    ? hydrateGoogleResult(result)
    : hydrateOpenLibraryResult(result, signal);
}

export function shouldUseGoogleFallback(query, results) {
  const q = String(query ?? '').trim();
  const isbn = normalizeIsbnQuery(q);
  if (isbn) return results.length === 0;
  if (results.length < 5) return true;
  const tokens = queryTokens(q);
  if (tokens.length <= 2) return true;
  const topScore = Math.max(0, ...results.map(result => relevanceScore(q, result)));
  return topScore < 0.72;
}

export function mergeResults(openLibraryResults = [], googleResults = []) {
  const merged = [];
  const seen = new Set();
  for (const result of [...openLibraryResults, ...googleResults]) {
    const key = dedupeKey(result);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(result);
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
  const title = normalizeText(result?.title);
  const author = normalizeText((result?.authors ?? []).join(' '));
  if (!q) return 0;

  const isbn = normalizeIsbnQuery(query);
  if (isbn) {
    const identifiers = [
      ...(result?.isbn13Candidates ?? []),
      ...(result?.isbn10Candidates ?? []),
    ].map(value => String(value).replace(/[^0-9Xx]/g, '').toLowerCase());
    return identifiers.includes(isbn.toLowerCase()) ? 2 : 0;
  }

  let score = 0;
  if (title === q) score += 1.2;
  else if (title.startsWith(q) || q.startsWith(title)) score += 0.9;

  const tokens = queryTokens(query);
  if (!tokens.length) return score;
  const titleHits = tokens.filter(token => title.includes(token)).length;
  const authorHits = tokens.filter(token => author.includes(token)).length;
  score += (titleHits / tokens.length) * 0.7;
  score += (authorHits / tokens.length) * 0.55;
  if (titleHits && authorHits) score += 0.25;
  return score;
}

function dedupeKey(result) {
  const isbn13 = result?.isbn13Candidates?.[0];
  if (isbn13) return `isbn:${isbn13}`;
  return `text:${normalizeText(result?.title)}|${normalizeText(result?.authors?.[0])}`;
}

function queryTokens(value) {
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
