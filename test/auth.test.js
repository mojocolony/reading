import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exercise the real sign-in handler so post-authentication failures cannot be
// accidentally reported as rejected credentials.
const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const handler = app.slice(app.indexOf('async function handleSignIn()'), app.indexOf('async function handleSignOut()'));
const authSource = readFileSync(new URL('../src/services/auth.js', import.meta.url), 'utf8').replace(/^import .*\n/, '').replaceAll('export ', '');
function harness(authFailure, syncFailure) {
  const messages = [];
  const button = {};
  const root = { querySelector: selector => selector.includes('password') ? { value: 'test-password' } : button };
  const context = vm.createContext({ root,
    fieldValue: () => 'test@example.test',
    renderAuthView: message => { messages.push(message); return message; },
    signIn: async () => { if (authFailure) throw authFailure; return { user: { id: 'test' } }; },
    loadCloudUser: async () => { if (syncFailure) throw syncFailure; },
  });
  vm.runInContext(authSource.slice(0, authSource.indexOf('async function signIn(')), context);
  vm.runInContext(handler, context);
  return { messages, run: () => context.handleSignIn() };
}

test('a network failure is not reported as rejected email or password', async () => {
  const h = harness(new TypeError('Failed to fetch'));
  await h.run();
  assert.doesNotMatch(h.messages[0], /password was not accepted/);
  assert.match(h.messages[0], /connect/);
});

test('unknown sign-in errors never expose raw errors or claim rejected credentials', async () => {
  const h = harness(new Error('private diagnostic details'));
  await h.run();
  assert.equal(h.messages[0], 'Reading could not sign in right now. Reload and try again.');
});

test('a successful sign-in followed by a loading failure is reported separately', async () => {
  const h = harness(null, new Error('local storage unavailable'));
  await h.run();
  assert.match(h.messages[0], /Signed in/);
  assert.doesNotMatch(h.messages[0], /password was not accepted/);
});

test('a confirmed credential rejection still explains the rejected credentials', async () => {
  const h = harness({ code: 'invalid_credentials' });
  await h.run();
  assert.equal(h.messages[0], 'Email or password was not accepted.');
});
