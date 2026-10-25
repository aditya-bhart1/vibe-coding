(() => {
  'use strict';

  const PRIMARY_SELECTOR = '[data-uia="player-skip-intro"]';
  const SCAN_INTERVAL_MS = 500;
  const CLICK_COOLDOWN_MS = 1500;
  const recentlyClicked = new WeakMap();

  function isVisible(element) {
    if (!(element instanceof Element)) return false;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function normalizeText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function looksLikeSkipIntro(element) {
    if (!(element instanceof Element) || !isVisible(element)) return false;

    if (element.matches(PRIMARY_SELECTOR)) return true;

    const aria = normalizeText(element.getAttribute('aria-label'));
    const title = normalizeText(element.getAttribute('title'));
    const text = normalizeText(element.textContent);

    const candidates = [aria, title, text];
    return candidates.some(value => value === 'skip intro' || value === 'skip recap');
  }

  function clickButton(element) {
    const lastClick = recentlyClicked.get(element) || 0;
    if (Date.now() - lastClick < CLICK_COOLDOWN_MS) return false;

    recentlyClicked.set(element, Date.now());
    element.click();
    return true;
  }

  function findSkipIntroButtons() {
    const found = new Set();

    document.querySelectorAll(PRIMARY_SELECTOR).forEach(element => found.add(element));

    // Narrow fallback: inspect interactive elements rather than the entire DOM text.
    document.querySelectorAll('button, [role="button"], [aria-label], [title]').forEach(element => {
      if (looksLikeSkipIntro(element)) found.add(element);
    });

    return found;
  }

  function scanAndClick() {
    for (const element of findSkipIntroButtons()) {
      if (looksLikeSkipIntro(element)) {
        clickButton(element);
      }
    }
  }

  let scanQueued = false;

  function queueScan() {
    if (scanQueued) return;
    scanQueued = true;

    requestAnimationFrame(() => {
      scanQueued = false;
      scanAndClick();
    });
  }

  const observer = new MutationObserver(() => queueScan());
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-label', 'title', 'class', 'style', 'hidden', 'data-uia']
  });

  // Netflix can update its player without producing a useful mutation for the
  // control itself, so keep a lightweight fallback scan running.
  window.setInterval(scanAndClick, SCAN_INTERVAL_MS);

  // Initial scan in case the player is already present when the script starts.
  scanAndClick();
})();
