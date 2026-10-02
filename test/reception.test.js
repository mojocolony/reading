import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { parseHTML } from 'linkedom';
import vm from 'node:vm';

const source = readFileSync(new URL('../supabase/functions/reading-reception/index.ts', import.meta.url), 'utf8');
const id = 'e8b5783b-2a64-42ab-aa4d-d476e977ebbe';
const book = { id, title: 'Biological War', author: 'Annie Jacobsen', isbn13: null, bookmarks_url: null, critical_reception: [], critical_reception_fetched_at: null };
// Minimal fixture follows the Book + embedded Review JSON-LD on the real Kirkus page.
const kirkus = `<meta property="og:description" content="A gloomy glimpse of war waged by microbes."><script type="application/ld+json">${JSON.stringify({ '@type': 'Book', name: 'BIOLOGICAL WAR', author: { name: 'Annie Jacobsen' }, isbn: '9798217046034', review: { '@type': 'Review', author: { name: 'Kirkus Reviews' }, reviewBody: 'Biological War describes a possible catastrophe. Jacobsen builds a vivid and rigorously researched scenario, but her relentless account leaves readers with little practical guidance for responding to it.' } })}</script>`;

function harness(row = book, respond = () => new Response('', { status: 404 })) {
  let handler;
  const updates = [];
  const client = { from() { return {
    select() { return { eq() { return { single: async () => ({ data: { ...row } }) }; } }; },
    update(patch) { const filters = []; const query = { eq(key, value) { filters.push([key, value]); return query; }, is(key, value) { filters.push([key, value]); return query; }, then(resolve) { if (filters.every(([key, value]) => (row[key] ?? null) === value)) updates.push(patch); return Promise.resolve({ error: null }).then(resolve); } }; return query; },
  }; } };
  const context = vm.createContext({ Request, Response, URL, AbortSignal, TextDecoder, Date, console, setTimeout, clearTimeout, parseHTML,
    fetch: respond,
    createClient: () => client,
    Deno: { env: { get: () => 'test-config' }, serve: fn => { handler = fn; } },
  });
  vm.runInContext(stripTypeScriptTypes(source.replace(/^import .*\n/gm, '')), context);
  return { updates, context, async invoke(options = {}) {
    const response = await handler(new Request('https://example.test', { method: 'POST', headers: { Authorization: 'Bearer test' }, body: JSON.stringify({ bookId: id, ...options }) }));
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
  assert.match(result.reviews[0]?.excerpt ?? '', /rigorously researched/);
  assert.ok(result.reviews[0].excerpt.split(/\s+/).length <= 25);
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

test('a current complete cached result remains usable without network', async () => {
  const row = { ...book, critical_reception: ['Booklist', 'Kirkus Reviews', 'Publishers Weekly'].map(outlet => ({ outlet, excerpt: 'An informative and carefully researched account of an important subject.', reviewer: null, rating: 'Positive' })), critical_reception_meta: { version: 3, bookKey: 'biological war|annie jacobsen', complete: true }, critical_reception_source_url: 'https://bookmarks.reviews/reviews/biological-war/', critical_reception_fetched_at: new Date().toISOString() };
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
    if (requested.includes('api.tavily.com/search')) return Response.json({ results: [{ url }, { url: 'https://untrusted.example/review' }] });
    if (requested === url) return html(article);
    return new Response('', { status: 404 });
  });
  const result = await h.invoke();
  assert.equal(result.reviews[0]?.outlet, 'Christianity Today');
  assert.equal(result.reviews[0]?.reviewer, 'Myles Werntz');
  assert.equal(result.reviews[0]?.url, url);
});

test('thin older cached reviews are eligible for improvement', async () => {
  const h = harness({ ...book, critical_reception: [{ outlet: 'Kirkus Reviews', excerpt: 'A gloomy glimpse.', url: 'https://www.kirkusreviews.com/book-reviews/annie-jacobsen/biological-war/' }], critical_reception_source_url: 'https://www.kirkusreviews.com/book-reviews/annie-jacobsen/biological-war/', critical_reception_fetched_at: new Date().toISOString() }, withKirkus);
  const result = await h.invoke();
  assert.equal(result.source, 'reviews');
  assert.equal(result.cached, false);
  assert.match(result.reviews[0].excerpt, /rigorously researched/);
});

test('blocked discovery does not discard a successfully fetched independent review', async () => {
  const h = harness(book, input => String(input).includes('api.tavily.com') ? new Response('blocked', { status: 429 }) : withKirkus(input));
  assert.equal((await h.invoke()).reviews[0]?.outlet, 'Kirkus Reviews');
});

test('a clean miss is not persisted and can be retried', async () => {
  const h = harness(book, input => String(input).includes('api.tavily.com') ? Response.json({ results: [] }) : new Response('', { status: 404 }));
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

test('search uses authenticated Tavily and verifies returned pages rather than snippets', async () => {
  let search;
  const url = 'https://www.theguardian.com/books/2026/biological-war-review';
  const article = '<h1>Biological War review</h1><article><p>Annie Jacobsen presents a vivid scenario, but her heavily researched book offers little practical guidance to readers.</p></article>';
  const h = harness(book, (input, options) => {
    if (String(input).includes('api.tavily.com')) {
      search = options;
      return Response.json({ results: [{ url, content: 'Invented snippet that must not be shown.' }, { url: 'https://localhost/private' }] });
    }
    return String(input) === url ? html(article) : new Response('', { status: 404 });
  });
  const result = await h.invoke();
  assert.equal(search?.headers?.Authorization, 'Bearer test-config');
  assert.equal(JSON.parse(search.body).search_depth, 'basic');
  assert.equal(result.reviews[0]?.outlet, 'The Guardian');
  assert.match(result.reviews[0]?.excerpt ?? '', /heavily researched/);
  assert.doesNotMatch(JSON.stringify(result), /Invented snippet/);
});

test('failed refresh preserves previous useful reception and marks it stale', async () => {
  const previous = [{ outlet: 'Booklist', excerpt: 'A carefully researched, informative and unusually accessible account of its complex subject.' }];
  const h = harness({ ...book, critical_reception: previous }, () => { throw new Error('offline'); });
  const result = await h.invoke({ force: true });
  assert.equal(result.status, 200);
  assert.equal(result.stale, true);
  assert.equal(result.incomplete, true);
  assert.equal(result.reviews[0].excerpt, previous[0].excerpt);
  assert.equal(h.updates.length, 0);
});

test('a changed title cannot reuse a complete cache from the former book identity', async () => {
  const h = harness({ ...book, critical_reception: [{ outlet: 'Wrong book', excerpt: 'An old result.' }], critical_reception_fetched_at: new Date().toISOString(), critical_reception_meta: { version: 2, bookKey: 'another title|annie jacobsen', complete: true } }, withKirkus);
  assert.equal((await h.invoke()).reviews[0]?.outlet, 'Kirkus Reviews');
});

test('an old review list is not substituted for a changed identity after network failure', async () => {
  const h = harness({ ...book, critical_reception: [{ outlet: 'Wrong book', excerpt: 'An old result.' }], critical_reception_meta: { version: 2, bookKey: 'another title|annie jacobsen' } }, () => { throw new Error('offline'); });
  const result = await h.invoke();
  assert.equal(result.status, 503);
  assert.equal(result.reviews?.length ?? 0, 0);
});

test('a blocked provider is not reported as a clean no-review result', async () => {
  const h = harness(book, input => String(input).includes('api.tavily.com') ? new Response('quota exceeded', { status: 429 }) : new Response('', { status: 404 }));
  assert.equal((await h.invoke()).status, 503);
  assert.equal(h.updates.length, 0);
});

test('publisher praise for another book is rejected', () => {
  const h = harness();
  h.context.fixture = '<h1>Biological War</h1><div>Annie Jacobsen</div><section id="praise"><h2>Praise for Nuclear War</h2><p>"An extraordinarily vivid and carefully researched account of the subject." —The New Yorker</p></section>';
  assert.equal(vm.runInContext('parseVerifiedPublisherPraise(fixture, "https://www.penguinrandomhouse.com/books/783250/biological-war-by-annie-jacobsen/", "Biological War", "Annie Jacobsen").reviews.length', h.context), 0);
});

test('credential-bearing source destinations are never fetched', () => {
  const h = harness();
  assert.equal(vm.runInContext('professionalOutlet("https://user:password@www.theguardian.com/books/review")', h.context), null);
});

test('substantive excerpts do not stop inside abbreviations such as U.S.', () => {
  const h = harness();
  h.context.fixture = 'Although the author offers reassurance, her disturbing account of U.S. biological warfare remains rigorously researched and informative for readers.';
  const text = vm.runInContext('evaluativeExcerpt(fixture)', h.context);
  assert.match(text, /U\.S\. biological warfare/);
  assert.match(text, /rigorously researched/);
});

test('source redirects cannot fetch an untrusted private destination', async () => {
  const fetched = [];
  const h = harness(book, input => {
    fetched.push(String(input));
    return new Response('', { status: 302, headers: { Location: 'https://127.0.0.1/private' } });
  });
  await assert.rejects(vm.runInContext('fetchHtml("https://www.theguardian.com/books/review")', h.context), /Unsupported source destination/);
  assert.equal(fetched.length, 1);
});

test('a title mentioned after another book’s review subject cannot match', () => {
  const h = harness();
  h.context.fixture = '<h1>Doctor Sleep review: the sequel to The Shining</h1><article>Stephen King returns with a vividly written and compelling novel, but the sequel is uneven and repetitive.</article>';
  assert.equal(vm.runInContext('parseProfessionalReview(fixture, "https://www.theguardian.com/books/doctor-sleep-review", "The Shining", "Stephen King").reviews.length', h.context), 0);
});

test('publisher praise sections exclude endorsements after another book’s heading', () => {
  const h = harness();
  h.context.fixture = '<h1>Biological War by Annie Jacobsen</h1><section id="praise"><h2>Praise for Biological War</h2><p>A carefully researched, informative and unusually readable account of its complicated subject.</p><div>Booklist</div><h2>Praise for Nuclear War</h2><p>A vivid and compelling study of the risk of nuclear destruction in the modern world.</p><div>The Guardian</div></section>';
  const result = vm.runInContext('parseVerifiedPublisherPraise(fixture, "https://www.hachettebookgroup.com/titles/annie-jacobsen/biological-war/123/", "Biological War", "Annie Jacobsen")', h.context);
  assert.equal(result.reviews.length, 1);
  assert.equal(result.reviews[0].outlet, 'Booklist');
});

test('Book Marks extracts an assessment rather than truncating the opening synopsis', () => {
  const h = harness();
  h.context.fixture = '<h2>What The Reviewers Say</h2><p>Positive</p><div>Booklist</div><p>The protagonist travels across three countries in search of a missing painting while his family waits at home. The novel is a vivid and compelling account of loss, but its repetitive second half is disappointing.</p>';
  const result = vm.runInContext('parseBookMarksReviews(fixture)', h.context);
  assert.match(result[0].excerpt, /compelling account/);
  assert.doesNotMatch(result[0].excerpt, /protagonist travels/);
});

test('malformed provider entries leave an empty lookup retryable', async () => {
  const h = harness(book, input => String(input).includes('api.tavily.com') ? Response.json({ results: [{ error: 'bad entry' }] }) : new Response('', { status: 404 }));
  assert.equal((await h.invoke()).status, 503);
  assert.equal(h.updates.length, 0);
});

test('redirecting to another outlet cannot misattribute that outlet’s review', async () => {
  const h = harness(book, () => new Response('', { status: 302, headers: { Location: 'https://www.nytimes.com/books/review' } }));
  await assert.rejects(vm.runInContext('fetchHtml("https://www.theguardian.com/books/review")', h.context), /different outlet/);
});

test('short review subjects and books with the same title prefix remain distinct', () => {
  const h = harness();
  h.context.fixture = '<h1>It review: recalling The Shining</h1><article>Stephen King presents a vivid and compelling novel, but the sequel is uneven and repetitive.</article>';
  assert.equal(vm.runInContext('parseProfessionalReview(fixture, "https://www.theguardian.com/books/it-review", "The Shining", "Stephen King").reviews.length', h.context), 0);
  h.context.fixture = `<script type="application/ld+json">${JSON.stringify({ '@type': 'Book', name: 'Dune Messiah', author: { name: 'Frank Herbert' }, review: { reviewBody: 'A vivid and compelling account of a fascinating subject with an unusually accessible and nuanced approach.' } })}</script>`;
  assert.equal(vm.runInContext('parseProfessionalReview(fixture, "https://www.kirkusreviews.com/book-reviews/frank-herbert/dune-messiah/", "Dune", "Frank Herbert").reviews.length', h.context), 0);
});

test('Book Marks verifies its real div-based title and author markup', () => {
  const h = harness();
  h.context.fixture = '<div class="bookmarks_full_title_holder"><div class="book_detail_title">Biological War: A Scenario</div><div class="book_detail_author">Annie Jacobsen</div></div><div>What The Reviewers Say</div>';
  assert.equal(vm.runInContext('matchesBook(fixture, "Biological War", "Annie Jacobsen")', h.context), true);
  assert.equal(vm.runInContext('matchesBook(fixture, "Biological War", "Other Author")', h.context), false);
});

test('ISBN enrichment does not overwrite an ISBN saved while lookup is running', async () => {
  const row = { ...book };
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const h = harness(row, async input => {
    if (String(input).includes('kirkusreviews.com')) { await waiting; return html(kirkus); }
    return new Response('', { status: 404 });
  });
  const lookup = h.invoke();
  await new Promise(resolve => setImmediate(resolve));
  row.isbn13 = '9780593099322';
  release();
  await lookup;
  assert.equal(h.updates.length, 0);
  assert.equal(row.isbn13, '9780593099322');
});

test('Book Marks enrichment does not overwrite a link edited during lookup', async () => {
  const row = { ...book };
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const markup = '<div class="book_detail_title">Biological War</div><div class="book_detail_author">Annie Jacobsen</div><h2>What The Reviewers Say</h2><p>Positive</p><div>Booklist</div><p>A deeply researched and informative account that makes the subject vivid and accessible.</p>';
  const h = harness(row, async input => {
    if (String(input).includes('bookmarks.reviews/reviews/')) { await waiting; return html(markup); }
    return new Response('', { status: 404 });
  });
  const lookup = h.invoke();
  await new Promise(resolve => setImmediate(resolve));
  row.bookmarks_url = 'https://bookmarks.reviews/reviews/manually-chosen/';
  release();
  await lookup;
  assert.equal(h.updates.length, 0);
  assert.equal(row.bookmarks_url, 'https://bookmarks.reviews/reviews/manually-chosen/');
});

test('Book Marks assessment starts with the requested book rather than an earlier novel', () => {
  const h = harness();
  h.context.fixture = '<h2>What The Reviewers Say</h2><p>Rave</p><div>David S. Wallace,</div><div>The New Yorker</div><p>Diaz gives Håkan a clever, vivid and compelling journey in his earlier novel. Trust, in the end, delivers a luminous and thoughtful exploration of money and literary invention.</p>';
  const result = vm.runInContext('parseBookMarksReviews(fixture, "Trust")', h.context);
  assert.match(result[0].excerpt, /Trust/);
  assert.doesNotMatch(result[0].excerpt, /Håkan|earlier novel/);
});

test('the old excerpt-selection cache is automatically eligible for replacement', async () => {
  const h = harness({ ...book, critical_reception: [{ outlet: 'Kirkus Reviews', excerpt: 'An earlier cached review that should be improved by the new extractor.' }], critical_reception_meta: { version: 2, bookKey: 'biological war|annie jacobsen', complete: true }, critical_reception_fetched_at: new Date().toISOString() }, withKirkus);
  const result = await h.invoke();
  assert.equal(result.cached, false);
  assert.match(result.reviews[0].excerpt, /rigorously researched/);
});

test('Book Marks reads structured reviewer and outlet fields independently', () => {
  const h = harness();
  h.context.fixture = '<h2>What The Reviewers Say</h2><span itemprop="review"><div class="bookmarks_pullquote_reviewer"><span class="review_rating">Rave</span><span itemprop="author"><a><span itemprop="name">David S. Wallace,</span></a></span><br><a class="bookmarks_source_link">The New Yorker</a></div><div itemprop="reviewBody">Diaz gives Håkan a clever, vivid and compelling journey in his earlier novel. Trust offers a luminous and thoughtful exploration of money and literary invention.</div></span>';
  const result = vm.runInContext('parseBookMarksReviews(fixture, "Trust")', h.context);
  assert.equal(result[0].outlet, 'The New Yorker');
  assert.equal(result[0].reviewer, 'David S. Wallace');
  assert.match(result[0].excerpt, /Trust/);
});
