import { icon } from './icons.js';
import { escapeHtml } from './markup.js';

export function renderAuthView(message = '') {
  return `<div class="auth-shell">
    <div class="auth-card">
      <div class="auth-brand"><span>${icon('book-open-text', { size: 24 })}</span><h1>Reading</h1></div>
      <p class="auth-copy">Sign in to sync your books across devices.</p>
      ${message ? `<p class="auth-message" role="alert">${escapeHtml(message)}</p>` : ''}
      <label class="field-label" for="auth-email">Email</label>
      <input id="auth-email" class="text-field" type="email" autocomplete="username" data-field="auth-email">
      <label class="field-label" for="auth-password">Password</label>
      <input id="auth-password" class="text-field" type="password" autocomplete="current-password" data-field="auth-password">
      <button class="primary-button" type="button" data-action="sign-in">Sign in</button>
    </div>
  </div>`;
}
