import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/services/critical-reception.js', import.meta.url), 'utf8').replace(/^import .*\n/, '').replaceAll('export ', '');
const id = 'e8b5783b-2a64-42ab-aa4d-d476e977ebbe';
class Element {
  children = [];
  dataset = { bookId: id };
  append(...items) { this.children.push(...items); }
  replaceChildren() { this.children = []; }
  addEventListener(name, handler) { this[name] = handler; }
}
function harness(results) {
  let call = 0;
  const region = new Element();
  const root = { querySelectorAll: () => [region], querySelector: () => region };
  const context = vm.createContext({ URL, document: { createElement: () => new Element() }, console,
    getSupabaseClient: async () => ({ functions: { invoke: async () => results[Math.min(call++, results.length - 1)] } }),
  });
  vm.runInContext(source, context);
  return { region, clear: () => context.clearCriticalReceptionMemoryCache(), refresh: (book = { id }, options = {}, onResolved = () => {}) => context.refreshCriticalReception(root, [book], onResolved, options), get calls() { return call; } };
}

test('an empty response can be retried on reopening the book', async () => {
  const h = harness([{ data: { reviews: [] } }, { data: { source: 'reviews', reviews: [{ outlet: 'Kirkus Reviews', excerpt: 'A gloomy glimpse.', url: 'https://www.kirkusreviews.com/book-reviews/annie-jacobsen/biological-war/' }] } }]);
  await h.refresh();
  await h.refresh();
  assert.equal(h.region.children[0]?.children[0]?.textContent, 'Kirkus Reviews');
});

test('publisher selections have an explicit praise label and publisher link', async () => {
  const h = harness([{ data: { source: 'publisher', reviews: [{ outlet: 'Booklist', excerpt: 'A carefully researched review.', kind: 'publisher-praise', url: 'https://www.hachettebookgroup.com/titles/author/book/123/' }] } }]);
  await h.refresh();
  assert.match(h.region.children[0].children[0].textContent, /Publisher-selected praise/);
  assert.equal(h.region.children[0].children.find(child => child.href)?.textContent, 'Publisher source ↗');
});

test('a changed title refreshes browser memory instead of showing another book’s reviews', async () => {
  const h = harness([{ data: { source: 'reviews', reviews: [{ outlet: 'First', excerpt: 'A first review.' }] } }, { data: { source: 'reviews', reviews: [{ outlet: 'Second', excerpt: 'A second review.' }] } }]);
  await h.refresh({ id, title: 'First book', author: 'Author' });
  await h.refresh({ id, title: 'Second book', author: 'Author' });
  assert.equal(h.calls, 2);
  assert.match(h.region.children[0].children[0].textContent, /Second/);
});

test('explicit refresh replaces a positive memory result', async () => {
  const h = harness([{ data: { reviews: [{ outlet: 'First', excerpt: 'A first review.' }] } }, { data: { reviews: [{ outlet: 'Improved', excerpt: 'An improved review.' }] } }]);
  await h.refresh();
  await h.refresh({ id }, { force: true });
  assert.equal(h.calls, 2);
  assert.match(h.region.children[0].children[0].textContent, /Improved/);
});

test('failed explicit refresh preserves the visible useful result', async () => {
  const h = harness([{ data: { reviews: [{ outlet: 'Saved', excerpt: 'A saved review.' }] } }, { error: new Error('offline') }]);
  await h.refresh();
  await h.refresh({ id }, { force: true });
  assert.match(h.region.children[0].children[0].textContent, /Saved/);
  assert.ok(h.region.children.some(child => /saved reviews/i.test(child.textContent ?? '')));
});

test('a refresh control remains available after an empty or unavailable result', async () => {
  const h = harness([{ error: new Error('offline') }]);
  await h.refresh();
  assert.ok(h.region.children.some(child => child.textContent === 'Refresh reviews'));
});

test('a late lookup cannot set an old Book Marks URL after the book identity changes', async () => {
  let resolve;
  const waiting = new Promise(done => { resolve = done; });
  const callbacks = [];
  const h = harness([waiting, { data: { source: 'reviews', reviews: [{ outlet: 'Current', excerpt: 'A current review.' }] } }]);
  const first = h.refresh({ id, title: 'Old', author: 'Author' }, {}, (...args) => callbacks.push(args));
  await h.refresh({ id, title: 'New', author: 'Author' });
  resolve({ data: { source: 'bookmarks', sourceUrl: 'https://bookmarks.reviews/reviews/old/', reviews: [{ outlet: 'Old', excerpt: 'An old review.' }] } });
  await first;
  assert.equal(callbacks.length, 0);
  assert.match(h.region.children[0].children[0].textContent, /Current/);
});

test('clearing reception memory also invalidates results from requests already in flight', async () => {
  let resolve;
  const waiting = new Promise(done => { resolve = done; });
  const h = harness([waiting, { data: { reviews: [{ outlet: 'New session', excerpt: 'A new review.' }] } }]);
  const first = h.refresh();
  h.clear();
  resolve({ data: { reviews: [{ outlet: 'Old session', excerpt: 'An old review.' }] } });
  await first;
  await h.refresh();
  assert.equal(h.calls, 2);
  assert.match(h.region.children[0].children[0].textContent, /New session/);
});

test('an expired server cache is eligible for improvement in the browser', async () => {
  const h = harness([{ data: { expiresAt: new Date(Date.now() - 1000).toISOString(), reviews: [{ outlet: 'Expired', excerpt: 'An expired review.' }] } }, { data: { reviews: [{ outlet: 'Fresh', excerpt: 'A fresh review.' }] } }]);
  await h.refresh();
  await h.refresh();
  assert.equal(h.calls, 2);
  assert.match(h.region.children[0].children[0].textContent, /Fresh/);
});

test('each independently sourced review links to its actual review page', async () => {
  const url = 'https://www.kirkusreviews.com/book-reviews/annie-jacobsen/biological-war/';
  const h = harness([{ data: { source: 'reviews', sourceUrl: url, reviews: [{ outlet: 'Kirkus Reviews', excerpt: 'A gloomy glimpse.', url }] } }]);
  await h.refresh();
  const link = h.region.children[0].children.find(child => child.href);
  assert.equal(link?.href, url);
  assert.equal(link?.textContent, 'Read review ↗');
});

test('unsafe source URLs never become clickable review links', async () => {
  const h = harness([{ data: { source: 'reviews', reviews: [{ outlet: 'Test', excerpt: 'A review.', url: 'javascript:alert(1)' }] } }]);
  await h.refresh();
  assert.equal(h.region.children[0].children.filter(child => child.href).length, 0);
});
