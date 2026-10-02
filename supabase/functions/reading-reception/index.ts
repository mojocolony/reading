import { createClient } from 'npm:@supabase/supabase-js@2.112.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

type ReviewExcerpt = {
  rating: string | null;
  reviewer: string | null;
  outlet: string;
  excerpt: string;
};

type ReceptionResult = {
  reviews: ReviewExcerpt[];
  source: 'bookmarks' | 'publisher' | null;
  sourceUrl: string | null;
  isbn13?: string | null;
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authorization = req.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);

  try {
    const body = await req.json();
    const bookId = String(body?.bookId ?? '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(bookId)) return json({ error: 'Invalid book id' }, 400);

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const publishableKey = getPublishableKey();
    if (!supabaseUrl || !publishableKey) return json({ error: 'Server configuration is incomplete' }, 500);

    const supabase = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: book, error: bookError } = await supabase
      .from('reading_books')
      .select('id,title,author,isbn13,bookmarks_url,critical_reception,critical_reception_source_url,critical_reception_fetched_at')
      .eq('id', bookId)
      .single();

    if (bookError || !book) return json({ error: 'Book not found' }, 404);

    const cachedReviews = Array.isArray(book.critical_reception) ? book.critical_reception : [];
    const cacheAge = book.critical_reception_fetched_at
      ? Date.now() - new Date(book.critical_reception_fetched_at).getTime()
      : Infinity;
    const cacheTtl = cachedReviews.length ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;

    if (cacheAge < cacheTtl) {
      return json({
        reviews: cachedReviews,
        source: inferSource(book.critical_reception_source_url),
        sourceUrl: book.critical_reception_source_url ?? null,
        cached: true,
      });
    }

    let result = await fetchBookMarksReception(book.title, book.author, book.bookmarks_url);
    if (!result.reviews.length) {
      result = await fetchHachettePraise(book.title, book.author, book.isbn13);
    }

    const fetchedAt = new Date().toISOString();
    const patch: Record<string, unknown> = {
      critical_reception: result.reviews,
      critical_reception_source_url: result.sourceUrl,
      critical_reception_fetched_at: fetchedAt,
    };
    if (result.source === 'bookmarks' && result.sourceUrl) patch.bookmarks_url = result.sourceUrl;
    if (!book.isbn13 && result.isbn13) patch.isbn13 = result.isbn13;

    const { error: updateError } = await supabase
      .from('reading_books')
      .update(patch)
      .eq('id', book.id);

    if (updateError) console.error('Reading reception cache update failed', updateError.message);

    return json({ ...result, cached: false, fetchedAt });
  } catch (error) {
    console.error('reading-reception error', error);
    return json({ error: 'Could not load critical reception' }, 500);
  }
});

async function fetchBookMarksReception(title: string, author: string, knownUrl?: string | null): Promise<ReceptionResult> {
  const directCandidates = bookMarksCandidates(title, knownUrl);
  const direct = await tryBookMarksCandidates(directCandidates, title, author);
  if (direct.reviews.length) return direct;

  const discovered: string[] = [];
  for (const query of [...new Set([`${title} ${author}`.trim(), title].filter(Boolean))]) {
    discovered.push(...await discoverBookMarksViaWpApi(query));

    const searchHtml = await fetchHtml(`https://bookmarks.reviews/?s=${encodeURIComponent(query)}`);
    if (searchHtml) discovered.push(...extractBookMarksReviewLinks(searchHtml));
  }

  const searched = await tryBookMarksCandidates([...new Set(discovered)].slice(0, 16), title, author);
  if (searched.reviews.length) return searched;

  return { reviews: [], source: null, sourceUrl: null };
}

async function tryBookMarksCandidates(urls: string[], title: string, author: string): Promise<ReceptionResult> {
  for (const candidate of urls) {
    const pageUrl = candidate.includes('/reviews/all/')
      ? candidate
      : candidate.replace('/reviews/', '/reviews/all/');
    const html = await fetchHtml(pageUrl);
    if (!html) continue;
    if (!matchesBook(html, title, author)) continue;
    const reviews = parseBookMarksReviews(html);
    if (reviews.length) {
      const canonical = pageUrl.replace('/reviews/all/', '/reviews/');
      return {
        reviews: reviews.slice(0, 3),
        source: 'bookmarks',
        sourceUrl: canonical,
        isbn13: extractBookMarksIsbn(html),
      };
    }
  }
  return { reviews: [], source: null, sourceUrl: null };
}

async function discoverBookMarksViaWpApi(query: string) {
  try {
    const url = `https://bookmarks.reviews/wp-json/wp/v2/search?search=${encodeURIComponent(query)}&per_page=20&subtype=any`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Reading/0.1.4 (+https://mojocolony.github.io/reading/)',
        'Accept': 'application/json',
      },
    });
    if (!response.ok) return [];
    const payload = await response.json();
    if (!Array.isArray(payload)) return [];
    return payload
      .map((item: any) => String(item?.url ?? ''))
      .filter((url: string) => {
        try {
          const parsed = new URL(url);
          return parsed.hostname.endsWith('bookmarks.reviews') && parsed.pathname.includes('/reviews/');
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

function extractBookMarksIsbn(html: string) {
  const match = html.match(/data-isbn=["'](\d{13})["']/i);
  return match?.[1] ?? null;
}

function extractBookMarksReviewLinks(html: string) {
  const links: string[] = [];
  const pattern = /href=["']([^"']*\/reviews\/(?!all\/)[^"'?#]+\/?)[^"']*["']/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    try {
      const url = new URL(match[1], 'https://bookmarks.reviews/');
      if (url.hostname.endsWith('bookmarks.reviews')) links.push(url.toString());
    } catch {}
  }
  return [...new Set(links)];
}

function bookMarksCandidates(title: string, knownUrl?: string | null) {
  const urls: string[] = [];
  if (knownUrl) {
    try {
      const u = new URL(knownUrl);
      if (u.hostname.endsWith('bookmarks.reviews') && u.pathname.includes('/reviews/')) {
        const base = u.href.replace(/\?.*$/, '');
        urls.push(base.includes('/reviews/all/') ? base : base.replace('/reviews/', '/reviews/all/'));
        urls.push(base.replace('/reviews/all/', '/reviews/'));
      }
    } catch {}
  }

  const fullSlug = slugify(title);
  const mainSlug = slugify(String(title).split(':')[0]);
  for (const slug of [...new Set([fullSlug, mainSlug].filter(Boolean))]) {
    urls.push(`https://bookmarks.reviews/reviews/all/${slug}/`);
    urls.push(`https://bookmarks.reviews/reviews/${slug}/`);
  }
  return [...new Set(urls)];
}

function matchesBook(html: string, title: string, author: string) {
  const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const pageTitle = titleMatch ? cleanText(titleMatch[1]) : '';
  const wantedTitle = normalizeText(title);
  const foundTitle = normalizeText(pageTitle);
  const titleOk = foundTitle === wantedTitle || foundTitle.startsWith(wantedTitle) || wantedTitle.startsWith(foundTitle);
  if (!titleOk) return false;

  const beforeReviews = cleanText(html.slice(0, Math.max(0, html.search(/What\s+The\s+Reviewers\s+Say/i))));
  const wantedAuthor = normalizeText(author);
  return !wantedAuthor || normalizeText(beforeReviews).includes(wantedAuthor);
}

function parseBookMarksReviews(html: string): ReviewExcerpt[] {
  const start = html.search(/What\s+The\s+Reviewers\s+Say/i);
  if (start < 0) return [];
  const tail = html.slice(start);
  const endMatch = tail.search(/SIMILAR\s+BOOKS/i);
  const segment = endMatch >= 0 ? tail.slice(0, endMatch) : tail.slice(0, 45000);
  const lines = htmlToLines(segment).filter(line =>
    line &&
    !/^What The Reviewers Say$/i.test(line) &&
    !/^Read Full Review/i.test(line) &&
    !/^See All Reviews/i.test(line)
  );

  const reviews: ReviewExcerpt[] = [];
  const ratingPattern = /^(Rave|Positive|Mixed|Pan)$/i;
  const inlinePattern = /^(Rave|Positive|Mixed|Pan)\s+(.+)$/i;

  for (let i = 0; i < lines.length && reviews.length < 5; i++) {
    const standalone = lines[i].match(ratingPattern);
    const inline = lines[i].match(inlinePattern);
    if (!standalone && !inline) continue;

    const rating = capitalize((standalone ?? inline)![1]);
    let reviewer: string | null = null;
    let outlet = '';
    let cursor = i + 1;

    if (inline) {
      const head = inline[2].trim();
      const comma = head.indexOf(',');
      if (comma >= 0) {
        reviewer = head.slice(0, comma).trim() || null;
        outlet = head.slice(comma + 1).trim();
      } else {
        reviewer = head || null;
      }
    }

    if (!outlet && cursor < lines.length) {
      const first = cleanInline(lines[cursor]);
      const second = cleanInline(lines[cursor + 1] ?? '');

      if (reviewer) {
        if (first && !looksLikeExcerpt(first) && !ratingPattern.test(first)) {
          outlet = first.replace(/^,+\s*/, '');
          cursor += 1;
        }
      } else if (first) {
        if (first.endsWith(',')) {
          reviewer = first.slice(0, -1).trim() || null;
          cursor += 1;
          const candidateOutlet = cleanInline(lines[cursor] ?? '');
          if (candidateOutlet && !looksLikeExcerpt(candidateOutlet) && !ratingPattern.test(candidateOutlet)) {
            outlet = candidateOutlet;
            cursor += 1;
          }
        } else if (!looksLikeExcerpt(first) && !ratingPattern.test(first)) {
          if (second && !looksLikeExcerpt(second) && !ratingPattern.test(second)) {
            reviewer = first;
            outlet = second;
            cursor += 2;
          } else {
            outlet = first;
            cursor += 1;
          }
        }
      }
    }

    const excerptParts: string[] = [];
    let j = cursor;
    for (; j < lines.length; j++) {
      if (ratingPattern.test(lines[j]) || inlinePattern.test(lines[j])) break;
      if (/^(Read Full Review|See All Reviews|SIMILAR BOOKS)/i.test(lines[j])) continue;
      excerptParts.push(lines[j]);
      if (excerptParts.join(' ').length > 900) break;
    }

    const excerpt = trimExcerpt(excerptParts.join(' '), 360);
    outlet = cleanInline(outlet);
    if (outlet && excerpt.length >= 24) {
      reviews.push({
        rating,
        reviewer: reviewer ? cleanInline(reviewer) : null,
        outlet,
        excerpt,
      });
    }
    i = Math.max(i, j - 1);
  }

  return dedupeReviews(reviews);
}

async function fetchHachettePraise(title: string, author: string, isbn13?: string | null): Promise<ReceptionResult> {
  if (!isbn13 || !/^\d{13}$/.test(isbn13)) return { reviews: [], source: null, sourceUrl: null };
  const authorSlug = slugify(author);
  const titleSlug = slugify(String(title).split(':')[0]);
  if (!authorSlug || !titleSlug) return { reviews: [], source: null, sourceUrl: null };

  const candidates = [
    `https://www.hachettebookgroup.com/titles/${authorSlug}/${titleSlug}/${isbn13}/`,
    `https://www.hbglibrary.com/titles/${authorSlug}/${titleSlug}/${isbn13}/`,
  ];

  for (const url of candidates) {
    const html = await fetchHtml(url);
    if (!html) continue;
    const reviews = parsePublisherPraise(html);
    if (reviews.length) return { reviews: reviews.slice(0, 3), source: 'publisher', sourceUrl: url };
  }
  return { reviews: [], source: null, sourceUrl: null };
}

function parsePublisherPraise(html: string): ReviewExcerpt[] {
  const start = html.search(/>\s*Praise\s*</i);
  if (start < 0) return [];
  const tail = html.slice(start);
  const end = tail.search(/>\s*(?:Also by|You May Also Like|Related Books|About the Author)\s*</i);
  const segment = end > 0 ? tail.slice(0, end) : tail.slice(0, 35000);
  const lines = htmlToLines(segment).filter(line => line && !/^Praise$/i.test(line));

  const reviews: ReviewExcerpt[] = [];
  for (let i = 0; i < lines.length - 1 && reviews.length < 5; i++) {
    const line = cleanInline(lines[i]);
    if (!looksLikeExcerpt(line)) continue;
    const next = cleanInline(lines[i + 1] ?? '');
    if (!next || looksLikeExcerpt(next) || next.length > 120) continue;
    reviews.push({
      rating: null,
      reviewer: null,
      outlet: next,
      excerpt: trimExcerpt(line, 360),
    });
    i += 1;
  }
  return dedupeReviews(reviews);
}

async function fetchHtml(url: string) {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Reading/0.1.4 (+https://mojocolony.github.io/reading/)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    if (!response.ok) return null;
    const type = response.headers.get('content-type') ?? '';
    if (!type.includes('text/html')) return null;
    return await response.text();
  } catch {
    return null;
  }
}

function htmlToLines(html: string) {
  const withBreaks = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6]|section|article|blockquote|a|span)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(withBreaks)
    .split(/\n+/)
    .map(cleanInline)
    .filter(Boolean);
}

function cleanText(html: string) {
  return cleanInline(decodeEntities(String(html).replace(/<[^>]+>/g, ' ')));
}

function cleanInline(value: string) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function decodeEntities(value: string) {
  return String(value)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&ldquo;|&rdquo;/gi, '"')
    .replace(/&lsquo;|&rsquo;/gi, "'")
    .replace(/&hellip;/gi, '...')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&#(\d+);/g, (_, n) => {
      try { return String.fromCodePoint(Number(n)); } catch { return ''; }
    });
}

function looksLikeExcerpt(value: string) {
  const text = cleanInline(value);
  return text.length >= 55 && /[.!?…”"']/.test(text);
}

function trimExcerpt(value: string, max: number) {
  const text = cleanInline(value).replace(/^["“]|["”]$/g, '');
  if (text.length <= max) return text;
  const clipped = text.slice(0, max - 1);
  const boundary = Math.max(clipped.lastIndexOf(' ... '), clipped.lastIndexOf('. '), clipped.lastIndexOf('; '), clipped.lastIndexOf(', '), clipped.lastIndexOf(' '));
  return `${clipped.slice(0, boundary > max * 0.6 ? boundary : clipped.length).trim()}…`;
}

function dedupeReviews(reviews: ReviewExcerpt[]) {
  const seen = new Set<string>();
  return reviews.filter(review => {
    const key = `${normalizeText(review.outlet)}|${normalizeText(review.excerpt).slice(0, 80)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function slugify(value: string) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeText(value: string) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function capitalize(value: string) {
  const lower = String(value).toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function inferSource(url?: string | null): ReceptionResult['source'] {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    if (host.endsWith('bookmarks.reviews')) return 'bookmarks';
    return 'publisher';
  } catch {
    return null;
  }
}

function getPublishableKey() {
  const legacy = Deno.env.get('SUPABASE_ANON_KEY');
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}');
    return keys.default ?? '';
  } catch {
    return '';
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}
