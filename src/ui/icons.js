const NODES = {
  'book-open-text': '<path d="M12 5v16"></path><path d="M16 13h2"></path><path d="M16 9h2"></path><path d="M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z"></path><path d="M6 13h2"></path><path d="M6 9h2"></path>',
  brain: '<path d="M12 18V5"></path><path d="M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4"></path><path d="M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5"></path><path d="M17.997 5.125a4 4 0 0 1 2.526 5.77"></path><path d="M18 18a4 4 0 0 0 2-7.464"></path><path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517"></path><path d="M6 18a4 4 0 0 1-2-7.464"></path><path d="M6.003 5.125a4 4 0 0 0-2.526 5.77"></path>',
  plus: '<path d="M5 12h14"></path><path d="M12 5v14"></path>',
  hamburger: '<path d="M12 16H4a2 2 0 1 1 0-4h16a2 2 0 1 1 0 4h-4.25"></path><path d="M5 12a2 2 0 0 1-2-2 9 7 0 0 1 18 0 2 2 0 0 1-2 2"></path><path d="M5 16a2 2 0 0 0-2 2 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 2 2 0 0 0-2-2q0 0 0 0"></path><path d="m6.67 12 6.13 4.6a2 2 0 0 0 2.8-.4l3.15-4.2"></path>',
  'chevron-down': '<path d="m6 9 6 6 6-6"></path>',
  'chevron-up': '<path d="m18 15-6-6-6 6"></path>',
  ellipsis: '<circle cx="5" cy="12" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle>',
  x: '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>',
  'arrow-left': '<path d="m12 19-7-7 7-7"></path><path d="M19 12H5"></path>',
};

export function icon(name, { size = 20, className = '', label = '' } = {}) {
  const nodes = NODES[name] ?? '';
  const aria = label ? ` role="img" aria-label="${escapeAttribute(label)}"` : ' aria-hidden="true"';
  return `<svg data-icon="${escapeAttribute(name)}" class="lucide-icon ${escapeAttribute(className)}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${aria}>${nodes}</svg>`;
}

function escapeAttribute(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
