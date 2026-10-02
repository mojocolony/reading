const SCRIPT_SRC = 'https://lithub.com/b/v1/bookmarks.js?ver=1.5.1';
let running = false;
let queued = false;

export function extractBookMarksUrl(container) {
  const anchor = container?.querySelector?.('a[href*="bookmarks.reviews"]');
  if (!anchor) return null;
  try {
    const url = new URL(anchor.href, globalThis.location?.href ?? 'https://bookmarks.reviews/');
    return /(^|\.)bookmarks\.reviews$/i.test(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
}

export function refreshBookMarksWidgets(root = document, onResolvedUrl = () => {}) {
  const widgets = [...root.querySelectorAll?.('.bm-reviews[data-isbn]:not([data-bm-attempted])') ?? []];
  if (!widgets.length) return;
  for (const widget of widgets) {
    widget.dataset.bmAttempted = '1';
    observeWidget(widget, onResolvedUrl);
  }
  queueScriptRun();
}

function observeWidget(widget, onResolvedUrl) {
  if (typeof MutationObserver === 'undefined') return;
  const section = widget.closest('.critical-reception');
  const observer = new MutationObserver(() => {
    const url = extractBookMarksUrl(widget);
    if (!url) return;
    observer.disconnect();
    onResolvedUrl(widget.dataset.bookId, url);
  });
  observer.observe(widget, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
  setTimeout(() => {
    const url = extractBookMarksUrl(widget);
    if (!url && (!widget.isConnected || !widget.textContent?.trim())) section?.remove();
    observer.disconnect();
  }, 10000);
}

function queueScriptRun() {
  if (running) {
    queued = true;
    return;
  }
  running = true;
  const script = document.createElement('script');
  script.src = SCRIPT_SRC;
  script.async = true;
  script.dataset.readingBookmarksLoader = '1';
  script.onload = script.onerror = () => {
    script.remove();
    running = false;
    if (queued) {
      queued = false;
      queueScriptRun();
    }
  };
  document.head.append(script);
}

export { SCRIPT_SRC };
