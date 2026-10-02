import { createClient } from 'npm:@supabase/supabase-js@2.112.4';
import { parseHTML } from 'npm:linkedom@0.18.12';

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
  url?: string;
  kind?: 'excerpt' | 'publisher-praise';
};

type ReceptionResult = {
  reviews: ReviewExcerpt[];
  source: 'bookmarks' | 'reviews' | 'publisher' | null;
  sourceUrl: string | null;
  isbn13?: string | null;
  incomplete?: boolean;
};

const LOOKUP_VERSION = 3;
const COMPLETE_TTL = 7 * 24 * 60 * 60 * 1000;
const PARTIAL_TTL = 24 * 60 * 60 * 1000;

function bookKey(title: string, author: string) {
  return `${normalizeText(title)}|${normalizeText(author)}`;
}

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
      .select('id,title,author,isbn13,bookmarks_url,critical_reception,critical_reception_source_url,critical_reception_fetched_at,critical_reception_meta')
      .eq('id', bookId)
      .single();

    if (bookError || !book) return json({ error: 'Book not found' }, 404);

    const identity = bookKey(book.title, book.author);
    const meta = book.critical_reception_meta;
    const sameIdentity = !meta?.bookKey || meta.bookKey === identity;
    const cachedReviews = sameIdentity && Array.isArray(book.critical_reception) ? book.critical_reception : [];
    const cacheAge = book.critical_reception_fetched_at
      ? Date.now() - new Date(book.critical_reception_fetched_at).getTime()
      : Infinity;
    const cacheTtl = meta?.complete ? COMPLETE_TTL : PARTIAL_TTL;

    if (!body.force && meta?.version === LOOKUP_VERSION && meta.bookKey === identity && cachedReviews.length && cacheAge >= 0 && cacheAge < cacheTtl) {
      return json({
        reviews: cachedReviews,
        source: inferSource(book.critical_reception_source_url),
        sourceUrl: book.critical_reception_source_url ?? null,
        cached: true,
        incomplete: !meta.complete,
        expiresAt: new Date(new Date(book.critical_reception_fetched_at).getTime() + cacheTtl).toISOString(),
      });
    }

    let failures = 0;
    async function attempt(load: () => Promise<ReceptionResult>): Promise<ReceptionResult> {
      try { return await load(); }
      catch (error) {
        failures += 1;
        console.warn('Reading review source unavailable', String(error));
        return { reviews: [], source: null, sourceUrl: null };
      }
    }
    const [bookMarksResult, professionalResult] = await Promise.all([
      attempt(() => fetchBookMarksReception(book.title, book.author, book.bookmarks_url)),
      attempt(() => fetchProfessionalReception(book.title, book.author, book.isbn13)),
    ]);
    let result: ReceptionResult = {
      reviews: mergeReviews(bookMarksResult.reviews, professionalResult.reviews).slice(0, 3),
      source: bookMarksResult.reviews.length ? 'bookmarks' : professionalResult.source,
      sourceUrl: bookMarksResult.sourceUrl || professionalResult.sourceUrl,
      isbn13: bookMarksResult.isbn13 || professionalResult.isbn13,
    };
    if (result.reviews.length < 3) {
      const publisher = await attempt(() => fetchHachettePraise(book.title, book.author, book.isbn13 || result.isbn13));
      result.reviews = mergeReviews(result.reviews, publisher.reviews).slice(0, 3);
      result.source ||= publisher.source;
      result.sourceUrl ||= publisher.sourceUrl;
    }
    result.incomplete = failures > 0 || Boolean(professionalResult.incomplete) || result.reviews.length < 3;
    // An unavailable source is not evidence that reviews do not exist. Never persist negative results.
    if (!result.reviews.length) {
      if (cachedReviews.length) return json({ reviews: cachedReviews, source: inferSource(book.critical_reception_source_url), sourceUrl: book.critical_reception_source_url, cached: true, stale: true, incomplete: true });
      return failures
        ? json({ error: 'Review sources are temporarily unavailable' }, 503)
        : json({ ...result, cached: false });
    }

    // A temporary outage must not replace useful results with a smaller list.
    if (result.incomplete) result.reviews = mergeReviews(result.reviews, cachedReviews).slice(0, 3);

    const fetchedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + (result.incomplete ? PARTIAL_TTL : COMPLETE_TTL)).toISOString();
    const patch: Record<string, unknown> = {
      critical_reception: result.reviews,
      critical_reception_source_url: result.sourceUrl,
      critical_reception_fetched_at: fetchedAt,
      critical_reception_meta: { version: LOOKUP_VERSION, bookKey: identity, complete: !result.incomplete, recheckAt: expiresAt },
    };
    if (result.source === 'bookmarks' && result.sourceUrl) patch.bookmarks_url = result.sourceUrl;
    if (!book.isbn13 && result.isbn13) patch.isbn13 = result.isbn13;

    let update = supabase
      .from('reading_books')
      .update(patch)
      .eq('id', book.id)
      .eq('title', book.title)
      .eq('author', book.author);
    if ('isbn13' in patch) update = update.is('isbn13', null);
    if ('bookmarks_url' in patch) update = book.bookmarks_url == null ? update.is('bookmarks_url', null) : update.eq('bookmarks_url', book.bookmarks_url);
    const { error: updateError } = await update;

    if (updateError) console.error('Reading reception cache update failed', updateError.message);

    return json({ ...result, cached: false, fetchedAt, expiresAt });
  } catch (error) {
    console.error('reading-reception error', error);
    return json({ error: 'Could not load critical reception' }, 500);
  }
});

async function fetchBookMarksReception(title: string, author: string, knownUrl?: string | null): Promise<ReceptionResult> {
  let failed = false;
  try {
    const direct = await tryBookMarksCandidates(bookMarksCandidates(title, knownUrl), title, author);
    if (direct.reviews.length) return direct;
  } catch { failed = true; }

  const discovered: string[] = [];
  const queries = [...new Set([`${title} ${author}`.trim(), title].filter(Boolean))];
  await Promise.all(queries.map(async query => {
    const [api, search] = await Promise.allSettled([
      discoverBookMarksViaWpApi(query),
      fetchHtml(`https://bookmarks.reviews/?s=${encodeURIComponent(query)}`),
    ]);
    if (api.status === 'fulfilled') discovered.push(...api.value);
    else failed = true;
    if (search.status === 'fulfilled' && search.value) discovered.push(...extractBookMarksReviewLinks(search.value));
    else if (search.status === 'rejected') failed = true;
  }));
  try {
    const searched = await tryBookMarksCandidates([...new Set(discovered)].slice(0, 8), title, author);
    if (searched.reviews.length) return searched;
  } catch { failed = true; }
  if (failed) throw new Error('Book Marks unavailable');
  return { reviews: [], source: null, sourceUrl: null };
}

async function tryBookMarksCandidates(urls: string[], title: string, author: string): Promise<ReceptionResult> {
  const pages = [...new Set(urls.map(url => url.includes('/reviews/all/') ? url : url.replace('/reviews/', '/reviews/all/')))];
  const results = await Promise.allSettled(pages.map(async pageUrl => {
    const html = await fetchHtml(pageUrl);
    if (!html || !matchesBook(html, title, author)) return null;
    const reviews = parseBookMarksReviews(html, title);
    return reviews.length ? {
      reviews: reviews.slice(0, 3).map(review => ({ ...review, kind: 'excerpt' as const, url: pageUrl.replace('/reviews/all/', '/reviews/') })), source: 'bookmarks' as const,
      sourceUrl: pageUrl.replace('/reviews/all/', '/reviews/'), isbn13: extractBookMarksIsbn(html),
    } : null;
  }));
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) return result.value;
  }
  if (results.some(result => result.status === 'rejected')) throw new Error('Book Marks candidate unavailable');
  return { reviews: [], source: null, sourceUrl: null };
}

async function discoverBookMarksViaWpApi(query: string) {
  try {
    const url = `https://bookmarks.reviews/wp-json/wp/v2/search?search=${encodeURIComponent(query)}&per_page=20&subtype=any`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(12000),
      headers: {
        'User-Agent': 'Reading/0.1.6 (+https://reading.mojocolony.com/)',
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
          return validSourceUrl(url) && isHost(parsed.hostname, 'bookmarks.reviews') && parsed.pathname.includes('/reviews/');
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
      if (validSourceUrl(url.href) && isHost(url.hostname, 'bookmarks.reviews')) links.push(url.toString());
    } catch {}
  }
  return [...new Set(links)];
}

function bookMarksCandidates(title: string, knownUrl?: string | null) {
  const urls: string[] = [];
  if (knownUrl) {
    try {
      const u = new URL(knownUrl);
      if (validSourceUrl(u.href) && isHost(u.hostname, 'bookmarks.reviews') && u.pathname.includes('/reviews/')) {
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
  const { document } = parseHTML(html);
  const pageTitle = document.querySelector('.book_detail_title, h1')?.textContent ?? '';
  const titleOk = bookTitleMatches(pageTitle, title);
  if (!titleOk) return false;

  const primaryAuthor = document.querySelector('.book_detail_author')?.textContent;
  if (primaryAuthor) return normalizeText(primaryAuthor) === normalizeText(author);
  const heading = document.querySelector('h1');
  const primaryRegion = heading?.parentElement;
  primaryRegion?.querySelectorAll('aside, nav, footer, script, style').forEach((node: any) => node.remove());
  const beforeReviews = cleanText(String(primaryRegion?.innerHTML ?? document.toString()).split(/What\s+The\s+Reviewers\s+Say/i)[0]);
  const wantedAuthor = normalizeText(author);
  return !wantedAuthor || normalizeText(beforeReviews).includes(wantedAuthor);
}

function parseBookMarksReviews(html: string, title = ""): ReviewExcerpt[] {
  const start = html.search(/What\s+The\s+Reviewers\s+Say/i);
  if (start < 0) return [];
  const tail = html.slice(start);
  const endMatch = tail.search(/SIMILAR\s+BOOKS/i);
  const segment = endMatch >= 0 ? tail.slice(0, endMatch) : tail.slice(0, 45000);
  const { document } = parseHTML(segment);
  const structured: ReviewExcerpt[] = [];
  const reviewNodes = [...document.querySelectorAll('[itemprop="review"]')];
  for (const node of reviewNodes) {
    const body = node.querySelector('[itemprop="reviewBody"]')?.textContent ?? '';
    const outlet = cleanInline(node.querySelector('.bookmarks_source_link')?.textContent ?? '');
    const reviewer = cleanInline(node.querySelector('[itemprop="author"] [itemprop="name"]')?.textContent ?? '').replace(/[,;]\s*$/, '');
    const rating = cleanInline(node.querySelector('.review_rating')?.textContent ?? '');
    const excerpt = evaluativeExcerpt(body, title);
    if (outlet && excerpt && /^(Rave|Positive|Mixed|Pan)$/i.test(rating)) {
      structured.push({ rating: capitalize(rating), reviewer: reviewer || null, outlet, excerpt });
    }
  }
  // Never reinterpret malformed structured credits through flattened page lines.
  if (reviewNodes.length) return dedupeReviews(structured).slice(0, 5);
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

    const excerpt = evaluativeExcerpt(excerptParts.join(' '), title);
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

const REVIEW_OUTLETS: Record<string, string> = {
  'kirkusreviews.com': 'Kirkus Reviews',
  'publishersweekly.com': 'Publishers Weekly',
  'nytimes.com': 'The New York Times',
  'washingtonpost.com': 'The Washington Post',
  'theguardian.com': 'The Guardian',
  'newyorker.com': 'The New Yorker',
  'christianitytoday.com': 'Christianity Today',
  'thetimes.com': 'The Times',
  'theatlantic.com': 'The Atlantic',
  'latimes.com': 'Los Angeles Times',
  'bostonglobe.com': 'The Boston Globe',
  'wsj.com': 'The Wall Street Journal',
  'ft.com': 'Financial Times',
  'popmatters.com': 'PopMatters',
  'newscientist.com': 'New Scientist',
  'spectator.co.uk': 'The Spectator',
  'booklistonline.com': 'Booklist',
};

const PUBLISHER_HOSTS = ['penguinrandomhouse.com', 'hachettebookgroup.com', 'hbglibrary.com', 'simonandschuster.com', 'harpercollins.com'];

function isHost(host: string, domain: string) { return host === domain || host.endsWith(`.${domain}`); }

function validSourceUrl(value: string) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') && [...Object.keys(REVIEW_OUTLETS), ...PUBLISHER_HOSTS, 'bookmarks.reviews'].some(host => isHost(u.hostname, host));
  } catch { return false; }
}

function professionalOutlet(value: string): string | null {
  try {
    const u = new URL(value);
    if (!validSourceUrl(value)) return null;
    return Object.entries(REVIEW_OUTLETS).find(([host]) => u.hostname === host || u.hostname.endsWith(`.${host}`))?.[1] ?? null;
  } catch { return null; }
}

function jsonLdObjects(html: string): any[] {
  const objects: any[] = [];
  function visit(value: any) {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== 'object') return;
    objects.push(value);
    if (value['@graph']) visit(value['@graph']);
  }
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(match[1])); } catch {}
  }
  return objects;
}

function metadata(html: string, key: string) {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = Object.fromEntries([...match[0].matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)].map(a => [a[1].toLowerCase(), a[3]]));
    if (attrs.property === key || attrs.name === key) return cleanText(attrs.content ?? '');
  }
  return '';
}

function titleMatches(found: string, wanted: string) {
  const a = normalizeText(found);
  const b = normalizeText(wanted.split(':')[0]);
  return Boolean(a && b) && (a === b || a.startsWith(`${b} `) || a.includes(` ${b} `) || a.endsWith(` ${b}`));
}

function bookTitleMatches(found: string, wanted: string) {
  const a = normalizeText(found.split(':')[0]);
  const b = normalizeText(wanted.split(':')[0]);
  return Boolean(a && b) && a === b;
}

function reviewHeadlineMatches(found: string, wanted: string) {
  if (!titleMatches(found, wanted)) return false;
  const normalized = normalizeText(found);
  const review = normalized.match(/\breview\b/);
  // In "Other Book review: ... Requested Book", the latter is context, not the subject.
  const subject = review ? normalized.slice(0, review.index).trim() : '';
  if (review && subject && !/^(?:a |the )?book$/.test(subject) && !titleMatches(subject, wanted)) return false;
  return true;
}

// Keep short excerpts and never infer a rating from an outlet's marketing metadata.
function shortReviewExcerpt(text: string) {
  const words = cleanInline(text).replace(/^[“"]|[”"]$/g, '').split(/\s+/);
  return words.length > 25 ? `${words.slice(0, 25).join(' ')}…` : words.join(' ');
}

function evaluativeExcerpt(value: string, title = "") {
  const text = cleanText(value);
  const allSentences = text.split(/(?<=[.!?])\s+(?=[A-Z“"'])/);
  // Reviews can compare an author's earlier book before discussing this one.
  // When the requested title appears, choose an assessment from that point on.
  const wanted = normalizeText(title.split(':')[0]);
  const anchor = wanted ? allSentences.findIndex(sentence => (` ${normalizeText(sentence)} `).includes(` ${wanted} `)) : -1;
  const sentences = anchor > 0 ? allSentences.slice(anchor) : allSentences;
  const ranked = sentences.map((sentence, index) => {
    const words = sentence.trim().split(/\s+/).length;
    const signals = sentence.match(/\b(?:best|pleasure|humor|revealing|worthy|funny|tedious|delight|sharp|astute|affecting|ingenious|clever|engrossing|elegant|challenging|vivid|compelling|rigorous(?:ly)?|researched|readable|believable|gripping|powerful|insightful|thoughtful|disturbing|convincing|illuminating|accessible|informative|masterful|moving|luminous|nuanced|exhausting|repetitive|flawed|disappointing|uneven|comforting|gruesome|guidance|shallow|original|engaging|beautiful|eloquent|fascinating|lucid|superb|brilliant|banal|clich[eé]|unconvincing|riveting|provocative)\b/gi) ?? [];
    const contrast = /\b(?:but|although|however|yet|despite)\b/i.test(sentence) ? 1 : 0;
    return { sentence: sentence.trim(), score: words >= 5 && signals.length ? signals.length * 2 + contrast : 0, index };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
  if (!ranked.length) return '';
  let excerpt = ranked[0].sentence;
  for (let i = ranked[0].index + 1; i < sentences.length && excerpt.split(/\s+/).length < 12; i++) excerpt += ` ${sentences[i].trim()}`;
  return excerpt.split(/\s+/).length >= 10 ? shortReviewExcerpt(excerpt) : '';
}

function parseProfessionalReview(html: string, url: string, title: string, author: string): ReceptionResult {
  const empty: ReceptionResult = { reviews: [], source: null, sourceUrl: null };
  const outlet = professionalOutlet(url);
  if (!outlet || !normalizeText(author)) return empty;
  const { document } = parseHTML(html);
  const objects = jsonLdObjects(html);
  const namedAuthor = (a: any): string => Array.isArray(a) ? a.map(namedAuthor).join(' ') : typeof a === 'string' ? a : String(a?.name ?? '');
  const hasType = (o: any, type: string) => [o?.['@type']].flat().includes(type);
  const matchingBook = objects.find(o => hasType(o, 'Book') && bookTitleMatches(String(o.name ?? ''), title) && normalizeText(namedAuthor(o.author)) === normalizeText(author));
  const embeddedReview = [matchingBook?.review].flat().find(r => r && typeof r === 'object');
  let text = '';
  let reviewer: string | null = null;
  if (matchingBook && embeddedReview?.reviewBody) {
    text = evaluativeExcerpt(embeddedReview.reviewBody, title);
    const credit = namedAuthor(embeddedReview.author);
    reviewer = credit && credit !== outlet ? credit : null;
  } else {
    const item = objects.find(o => ['Review', 'Article', 'NewsArticle', 'OpinionNewsArticle'].some(t => hasType(o, t)) && titleMatches(String(o.headline ?? o.name ?? ''), title));
    const pageTitle = String(item?.headline ?? document.querySelector('h1')?.textContent ?? metadata(html, 'og:title'));
    const article = document.querySelector('article') ?? document.querySelector('[itemprop="articleBody"]');
    // Sidebar, recommendation and navigation text cannot establish book identity.
    article?.querySelectorAll('aside, nav, footer, script, style, .related, .related-content, [aria-hidden="true"]').forEach((node: any) => node.remove());
    const body = [item?.articleBody, item?.reviewBody, article?.textContent].filter(Boolean).join(' ');
    const description = [item?.description, metadata(html, 'og:description'), metadata(html, 'description')].filter(Boolean).join(' ');
    const content = cleanText(`${body} ${description}`);
    if (!reviewHeadlineMatches(pageTitle, title) || !normalizeText(content).includes(normalizeText(author))) return empty;
    const isReview = hasType(item, 'Review') || /review/i.test(new URL(url).pathname + pageTitle) || /\b(?:book|novel|writing|account)\b/i.test(body);
    if (!isReview) return empty;
    text = evaluativeExcerpt(body, title) || evaluativeExcerpt(description, title);
    reviewer = namedAuthor(item?.author) || document.querySelector('[rel="author"]')?.textContent?.trim() || null;
  }
  if (!text) return empty;
  const isbn = String(matchingBook?.isbn ?? '').replace(/[^0-9]/g, '');
  return {
    reviews: [{ rating: null, reviewer, outlet, excerpt: text, url, kind: 'excerpt' }],
    source: 'reviews', sourceUrl: url,
    isbn13: /^\d{13}$/.test(isbn) ? isbn : null,
  };
}

async function discoverProfessionalLinks(title: string, author: string): Promise<string[]> {
  const key = Deno.env.get('TAVILY_API_KEY');
  if (!key) throw new Error('Search service is not configured');
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST', signal: AbortSignal.timeout(12000),
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `"${title}" "${author}" book review`, search_depth: 'basic', topic: 'general', max_results: 12, include_answer: false, include_raw_content: false, auto_parameters: false, include_domains: [...Object.keys(REVIEW_OUTLETS), ...PUBLISHER_HOSTS, 'bookmarks.reviews'] }),
  });
  if (!response.ok) throw new Error(`Review discovery: HTTP ${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload?.results)) throw new Error('Review discovery returned an invalid response');
  if (payload.results.some((item: any) => !item || typeof item.url !== 'string' || !item.url.trim())) throw new Error('Review discovery returned malformed entries');
  return [...new Set<string>(payload.results.map((item: any) => String(item?.url ?? '')).filter(validSourceUrl))].slice(0, 10);
}

async function fetchProfessionalReception(title: string, author: string, isbn13?: string | null): Promise<ReceptionResult> {
  const titleSlugs = [...new Set([slugify(title.split(':')[0]), slugify(title)])].filter(Boolean);
  const urls = titleSlugs.map(slug => `https://www.kirkusreviews.com/book-reviews/${slugify(author)}/${slug}/`);
  if (isbn13 && /^\d{13}$/.test(isbn13)) urls.push(`https://www.publishersweekly.com/${isbn13}`);
  let failures = 0;
  async function read(url: string): Promise<ReceptionResult> {
    try {
      if (isHost(new URL(url).hostname, 'bookmarks.reviews')) return await tryBookMarksCandidates([url], title, author);
      const html = await fetchHtml(url);
      if (!html) return { reviews: [], source: null, sourceUrl: null };
      return professionalOutlet(url) ? parseProfessionalReview(html, url, title, author) : parseVerifiedPublisherPraise(html, url, title, author);
    } catch { failures += 1; return { reviews: [], source: null, sourceUrl: null }; }
  }
  const [direct, discovered] = await Promise.all([
    Promise.all(urls.map(read)),
    discoverProfessionalLinks(title, author).catch(() => { failures += 1; return []; }),
  ]);
  const results = [...direct, ...await Promise.all(discovered.filter(url => !urls.includes(url)).map(read))];
  // Prefer direct review evidence; publisher selections supplement it.
  const all = results.flatMap(r => r.reviews);
  const reviews = mergeReviews(all.filter(r => r.kind !== 'publisher-praise'), all.filter(r => r.kind === 'publisher-praise')).slice(0, 3);
  if (reviews.length) return { reviews, source: inferSource(reviews[0].url), sourceUrl: reviews[0].url ?? null, isbn13: results.find(r => r.isbn13)?.isbn13 ?? null, incomplete: failures > 0 };
  if (failures) throw new Error('Independent review sources unavailable');
  return { reviews: [], source: null, sourceUrl: null };
}

function parseVerifiedPublisherPraise(html: string, url: string, title: string, author: string): ReceptionResult {
  const empty: ReceptionResult = { reviews: [], source: null, sourceUrl: null };
  if (!validSourceUrl(url) || !PUBLISHER_HOSTS.some(host => isHost(new URL(url).hostname, host))) return empty;
  const { document } = parseHTML(html);
  const heading = document.querySelector('h1')?.textContent ?? metadata(html, 'og:title');
  const objects = jsonLdObjects(html);
  const book = objects.find(o => [o['@type']].flat().includes('Book') && bookTitleMatches(String(o.name ?? ''), title) && normalizeText(JSON.stringify(o.author ?? '')).includes(normalizeText(author)));
  const pageIdentity = cleanText(`${heading} ${metadata(html, 'og:title')} ${metadata(html, 'og:description')}`);
  const productMeta = document.querySelector('meta[data-book-title][data-book-authors]');
  const productMatch = productMeta && bookTitleMatches(productMeta.getAttribute('data-book-title') ?? '', title) && normalizeText(productMeta.getAttribute('data-book-authors') ?? '') === normalizeText(author);
  const headingTitle = normalizeText(heading.split(':')[0]).split(` by ${normalizeText(author)}`)[0];
  if (!book && !productMatch && (!bookTitleMatches(headingTitle, title) || !normalizeText(pageIdentity).includes(normalizeText(author)))) return empty;
  const section = document.querySelector('#praise-copy, #praise, [id*="praise"], .praise, [data-tab="praise"]');
  const segment = section?.innerHTML ?? html;
  const lines = htmlToLines(segment);
  let active = !lines.some(line => /praise for/i.test(line));
  const relevant = lines.filter(line => {
    if (/praise for/i.test(line)) { active = bookTitleMatches(line.replace(/^.*?praise for\s*/i, ''), title); return false; }
    return active;
  });
  const escapedLines = relevant.map(line => `<p>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`).join('');
  const reviews = parsePublisherPraise(`<h2>Praise</h2>${escapedLines}`).map(review => ({ ...review, excerpt: shortReviewExcerpt(review.excerpt), kind: 'publisher-praise' as const, url }));
  return reviews.length ? { reviews: reviews.slice(0, 3), source: 'publisher', sourceUrl: url } : empty;
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

  const results = await Promise.allSettled(candidates.map(async url => {
    const html = await fetchHtml(url);
    if (!html) return null;
    const reviews = parseVerifiedPublisherPraise(html, url, title, author).reviews;
    return reviews.length ? { reviews: reviews.slice(0, 3), source: 'publisher' as const, sourceUrl: url } : null;
  }));
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) return result.value;
  }
  if (results.some(result => result.status === 'rejected')) throw new Error('Publisher review source unavailable');
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
    const inline = line.match(/^(.*?)\s*[—–]\s*(.{3,100})$/);
    const next = inline ? inline[2] : cleanInline(lines[i + 1] ?? '');
    if (!next || looksLikeExcerpt(next) || next.length > 120) continue;
    reviews.push({
      rating: null,
      reviewer: null,
      outlet: next,
      excerpt: shortReviewExcerpt(inline ? inline[1] : line),
    });
    if (!inline) i += 1;
  }
  return dedupeReviews(reviews);
}

async function fetchHtml(url: string) {
  const signal = AbortSignal.timeout(12000);
  const outlet = professionalOutlet(url);
  const initialHost = new URL(url).hostname;
  // Validate every redirect before following it; discovered URLs must remain on allowed public sources.
  for (let redirects = 0; redirects <= 4; redirects++) {
    if (!validSourceUrl(url)) throw new Error('Unsupported source destination');
    const response = await fetch(url, {
      redirect: 'manual', signal,
      headers: { 'User-Agent': 'Reading/0.1.7 (+https://reading.mojocolony.com/)', 'Accept': 'text/html,application/xhtml+xml' },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Source redirect has no destination');
      url = new URL(location, url).href;
      await response.body?.cancel();
      if (!validSourceUrl(url)) throw new Error('Unsupported source destination');
      if (outlet && professionalOutlet(url) !== outlet) throw new Error('Source redirected to a different outlet');
      if (isHost(initialHost, 'bookmarks.reviews') && !isHost(new URL(url).hostname, 'bookmarks.reviews')) throw new Error('Book Marks redirected outside its source');
      continue;
    }
    if ([404, 410].includes(response.status)) return null;
    if (!response.ok) throw new Error(`${new URL(url).hostname}: HTTP ${response.status}`);
    if (!(response.headers.get('content-type') ?? '').includes('text/html')) throw new Error('Unexpected source content type');
    // Keep large or malformed pages from exhausting an edge worker.
    const reader = response.body?.getReader();
    if (!reader) return '';
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2_000_000) { await reader.cancel(); throw new Error('Source page too large'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return new TextDecoder().decode(bytes);
  }
  throw new Error('Too many source redirects');
}

function mergeReviews(...groups: ReviewExcerpt[][]) {
  const seen = new Set<string>();
  return groups.flat().filter(review => {
    const key = normalizeText(review.outlet).replace(/^the /, '').replace(/ book review$/, '');
    if (!key || seen.has(key) || !review.excerpt) return false;
    seen.add(key);
    return true;
  });
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
    if (host === 'bookmarks.reviews' || host.endsWith('.bookmarks.reviews')) return 'bookmarks';
    if (professionalOutlet(url)) return 'reviews';
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
