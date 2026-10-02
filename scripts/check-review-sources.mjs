// Live source-parser check. No database writes or simulated authenticated-app claims.
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';

const source = readFileSync(new URL('../supabase/functions/reading-reception/index.ts', import.meta.url), 'utf8').replace(/^import .*\n/gm, '');
const context = vm.createContext({ parseHTML, fetch, Request, Response, URL, AbortSignal, TextDecoder, console, Deno: { serve() {} } });
vm.runInContext(stripTypeScriptTypes(source), context);
const cases = [
  ['Biological War', 'Annie Jacobsen', 'https://www.kirkusreviews.com/book-reviews/annie-jacobsen/biological-war/', 'review'],
  ['Biological War', 'Annie Jacobsen', 'https://www.penguinrandomhouse.com/books/783250/biological-war-by-annie-jacobsen/', 'praise'],
  ['Trans', 'Helen Joyce', 'https://www.kirkusreviews.com/book-reviews/helen-joyce/trans-ideology-meets-reality/', 'review'],
  ['Trust', 'Hernan Diaz', 'https://www.kirkusreviews.com/book-reviews/hernan-diaz/trust-diaz/', 'review'],
  ['Rock*: A Mainstream Alternative History of Alternative Mainstream Music', 'Chuck Klosterman', 'https://bookmarks.reviews/reviews/rock-a-mainstream-alternative-history-of-alternative-mainstream-music/', 'bookmarks'],
];

const outcomes = await Promise.all(cases.map(async ([title, author, url, kind]) => {
  const args = [title, author, url].map(JSON.stringify);
  try {
    const parser = kind === 'praise' ? 'parseVerifiedPublisherPraise' : 'parseProfessionalReview';
    let result;
    if (kind === 'bookmarks') {
      result = await vm.runInContext(`tryBookMarksCandidates([${args[2]}], ${args[0]}, ${args[1]})`, context);
    } else {
      const html = await vm.runInContext(`fetchHtml(${args[2]})`, context);
      context.fixture = html;
      result = vm.runInContext(`${parser}(fixture, ${args[2]}, ${args[0]}, ${args[1]})`, context);
    }
    return { title, author, kind, count: result.reviews.length, outlets: result.reviews.map(review => review.outlet), passed: result.reviews.length > 0 && result.reviews.every(review => review.excerpt.split(/\s+/).length <= 25) };
  } catch (error) {
    return { title, author, kind, passed: false, error: String(error) };
  }
}));
console.log(JSON.stringify(outcomes, null, 2));
if (outcomes.some(outcome => !outcome.passed)) process.exitCode = 1;
