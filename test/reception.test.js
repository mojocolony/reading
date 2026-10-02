import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const source = readFileSync(new URL('../supabase/functions/reading-reception/index.ts', import.meta.url), 'utf8');
const id = 'e8b5783b-2a64-42ab-aa4d-d476e977ebbe';
const book = { id, title: 'Biological War', author: 'Annie Jacobsen', isbn13: null, bookmarks_url: null, critical_reception: [], critical_reception_fetched_at: null };
// Minimal fixture follows the Book + embedded Review JSON-LD on the real Kirkus page.
const kirkus = `<meta property="og:description" content="A gloomy glimpse of war waged by microbes."><script type="application/ld+json">${JSON.stringify({ '@type': 'Book', name: 'BIOLOGICAL WAR', author: { name: 'Annie Jacobsen' }, isbn: '9798217046034', review: { '@type': 'Review', author: { name: 'Kirkus Reviews' }, reviewBody: 'A detailed review of this book.' } })}</script>`;

function harness(row = book, respond = () => new Response('', { status: 404 })) {
  let handler;
  const updates = [];
  const client = { from() { return {
    select() { return { eq() { return { single: async () => ({ data: row }) }; } }; },
    update(patch) { updates.push(patch); return { eq: async () => ({ error: null }) }; },
  }; } };
  const context = vm.createContext({ Request, Response, URL, AbortSignal, Date, console, setTimeout, clearTimeout,
    fetch: respond,
    createClient: () => client,
    Deno: { env: { get: () => 'test-config' }, serve: fn => { handler = fn; } },
  });
  vm.runInContext(stripTypeScriptTypes(source.replace(/^import .*\n/, '')), context);
  return { updates, context, async invoke() {
    const response = await handler(new Request('https://example.test', { method: 'POST', headers: { Authorization: 'Bearer test' }, body: JSON.stringify({ bookId: id }) }));
    return { status: response.status, ...await response.json() };
  } };
}

const html = content => new Response(content, { headers: { 'Content-Type': 'text/html' } });
const withKirkus = url => String(url) === 'https://www.kirkusreviews.com/book-reviews/annie-jacobsen/biological-war/' ? html(kirkus) : new Response('', { status: 404 });

test('a book without ISBN or Book Marks still gets an independently verified review', async () => {
  const h = harness(book, withKirkus);
  const result = await h.invoke();
  assert.equal(result.status, 200);
  assert.equal(result.source, 'reviews');
  assert.equal(result.reviews[0]?.outlet, 'Kirkus Reviews');
  assert.equal(result.reviews[0]?.excerpt, 'A gloomy glimpse of war waged by microbes.');
  assert.equal(result.reviews[0]?.url, 'https://www.kirkusreviews.com/book-reviews/annie-jacobsen/biological-war/');
  assert.equal(h.updates[0]?.isbn13, '9798217046034');
});

test('a recent empty cache does not block the newly available review', async () => {
  const h = harness({ ...book, critical_reception_fetched_at: new Date().toISOString() }, withKirkus);
  assert.equal((await h.invoke()).reviews[0]?.outlet, 'Kirkus Reviews');
});

test('a different author at the candidate URL is rejected', async () => {
  const h = harness(book, url => String(url).includes('kirkusreviews.com') ? html(kirkus.replace('Annie Jacobsen', 'Other Author')) : new Response('', { status: 404 }));
  assert.equal((await h.invoke()).reviews?.length ?? 0, 0);
});

test('a missing title in Book Marks markup cannot match an unrelated page', () => {
  const h = harness();
  assert.equal(vm.runInContext('matchesBook("<div>Annie Jacobsen</div>", "Biological War", "Annie Jacobsen")', h.context), false);
});

test('upstream failure is retryable and is never written as an empty successful cache', async () => {
  const h = harness(book, async () => { throw new Error('network offline'); });
  const result = await h.invoke();
  assert.equal(result.status, 503);
  assert.equal(h.updates.length, 0);
});

test('successful cached Book Marks reception remains usable without network', async () => {
  const row = { ...book, critical_reception: [{ outlet: 'Booklist', excerpt: 'A review.', reviewer: null, rating: 'Positive' }], critical_reception_source_url: 'https://bookmarks.reviews/reviews/biological-war/', critical_reception_fetched_at: new Date().toISOString() };
  const h = harness(row, () => { throw new Error('should not fetch'); });
  const result = await h.invoke();
  assert.equal(result.source, 'bookmarks');
  assert.equal(result.cached, true);
  assert.equal(result.reviews[0].outlet, 'Booklist');
});


test('broader discovery finds a professional review when direct URLs miss', async () => {
  const url = 'https://www.christianitytoday.com/2026/07/how-to-live-and-die-in-biological-war-annie-jacobsen-review/';
  const article = `<meta property="og:description" content="The scenario is vivid, but the book offers little guidance."><script type="application/ld+json">${JSON.stringify({ '@type': 'Article', headline: 'How to Live and Die in Biological War', author: { name: 'Myles Werntz' }, articleBody: 'A review of Biological War by Annie Jacobsen.' })}</script>`;
  const h = harness(book, input => {
    const requested = String(input);
    if (requested.includes('bing.com/search')) return new Response(`<rss><channel><item><link>${url}</link></item><item><link>https://untrusted.example/review</link></item></channel></rss>`);
    if (requested === url) return html(article);
    return new Response('', { status: 404 });
  });
  const result = await h.invoke();
  assert.equal(result.reviews[0]?.outlet, 'Christianity Today');
  assert.equal(result.reviews[0]?.reviewer, 'Myles Werntz');
  assert.equal(result.reviews[0]?.url, url);
});

test('cached independent reviews retain their source type and links', async () => {
  const h = harness({ ...book, critical_reception: [{ outlet: 'Kirkus Reviews', excerpt: 'A gloomy glimpse.', url: 'https://www.kirkusreviews.com/book-reviews/annie-jacobsen/biological-war/' }], critical_reception_source_url: 'https://www.kirkusreviews.com/book-reviews/annie-jacobsen/biological-war/', critical_reception_fetched_at: new Date().toISOString() });
  const result = await h.invoke();
  assert.equal(result.source, 'reviews');
  assert.equal(result.cached, true);
});

test('blocked discovery does not discard a successfully fetched independent review', async () => {
  const h = harness(book, input => String(input).includes('bing.com') ? new Response('blocked', { status: 429 }) : withKirkus(input));
  assert.equal((await h.invoke()).reviews[0]?.outlet, 'Kirkus Reviews');
});

test('a clean miss is not persisted and can be retried', async () => {
  const h = harness(book, input => String(input).includes('bing.com') ? new Response('<rss><channel></channel></rss>') : new Response('', { status: 404 }));
  const result = await h.invoke();
  assert.equal(result.status, 200);
  assert.equal(result.reviews.length, 0);
  assert.equal(h.updates.length, 0);
});

test('an author mentioned only in a sidebar cannot verify a review of a different book', () => {
  const h = harness();
  const html = '<meta property="og:title" content="Biological War review"><meta property="og:description" content="A review of a different author\'s book."><article>A review by another author.</article><aside>Annie Jacobsen also has a book out.</aside>';
  h.context.fixture = html;
  const result = vm.runInContext('parseProfessionalReview(fixture, "https://www.theguardian.com/books/2026/biological-war-review", "Biological War", "Annie Jacobsen")', h.context);
  assert.equal(result.reviews.length, 0);
});

test('a failed publisher candidate does not hide a working alternate publisher source', async () => {
  const praise = '<h1>Biological War by Annie Jacobsen</h1><h2>Praise</h2><p>A deeply researched, informative account that makes its subject vivid and accessible.</p><div>Booklist</div>';
  const h = harness(book, async input => {
    if (String(input).includes('hachettebookgroup.com')) throw new Error('temporary failure');
    if (String(input).includes('hbglibrary.com')) return html(praise);
    return new Response('', { status: 404 });
  });
  const result = await vm.runInContext('fetchHachettePraise("Biological War", "Annie Jacobsen", "9798217046034")', h.context).catch(() => ({ reviews: [] }));
  assert.equal(result.reviews[0]?.outlet, 'Booklist');
});

test('a failed Book Marks candidate does not hide another matching candidate', async () => {
  const review = '<h1>Biological War: A Scenario</h1><div>Annie Jacobsen</div><h2>What The Reviewers Say</h2><p>Positive</p><div>Booklist</div><p>A deeply researched and informative account that makes the subject vivid and accessible.</p>';
  const h = harness(book, async input => {
    if (String(input).includes('/biological-war-a-scenario/')) throw new Error('temporary failure');
    return html(review);
  });
  const result = await vm.runInContext('tryBookMarksCandidates(["https://bookmarks.reviews/reviews/all/biological-war-a-scenario/", "https://bookmarks.reviews/reviews/all/biological-war/"], "Biological War: A Scenario", "Annie Jacobsen")', h.context).catch(() => ({ reviews: [] }));
  assert.equal(result.reviews[0]?.outlet, 'Booklist');
});
