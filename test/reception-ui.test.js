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
}
function harness(results) {
  let call = 0;
  const region = new Element();
  const root = { querySelectorAll: () => [region], querySelector: () => region };
  const context = vm.createContext({ URL, document: { createElement: () => new Element() }, console,
    getSupabaseClient: async () => ({ functions: { invoke: async () => results[Math.min(call++, results.length - 1)] } }),
  });
  vm.runInContext(source, context);
  return { region, refresh: () => context.refreshCriticalReception(root, [{ id }]) };
}

test('an empty response can be retried on reopening the book', async () => {
  const h = harness([{ data: { reviews: [] } }, { data: { source: 'reviews', reviews: [{ outlet: 'Kirkus Reviews', excerpt: 'A gloomy glimpse.', url: 'https://www.kirkusreviews.com/book-reviews/annie-jacobsen/biological-war/' }] } }]);
  await h.refresh();
  await h.refresh();
  assert.equal(h.region.children[0]?.children[0]?.textContent, 'Kirkus Reviews');
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
