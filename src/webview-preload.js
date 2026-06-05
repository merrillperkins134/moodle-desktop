'use strict';

/*
 * Preload injected INTO the Nextcloud page (the <webview>).
 *
 * Responsibilities (all best-effort / defensive — Nextcloud's DOM is not a
 * stable API, so everything here is wrapped so a layout change can never break
 * the app):
 *   1. Report an unread badge count to the host page (optional nice-to-have).
 *
 * Native desktop notifications are handled by Electron automatically: the page
 * uses the standard web Notification API, the permission is auto-granted for
 * our origin in the main process, and Electron forwards them to libnotify/GNOME.
 */

const { ipcRenderer } = require('electron');

(function setupBadgeReporter() {
  let lastCount = -1;

  function readUnreadCount() {
    let total = 0;
    try {
      // Nextcloud renders unread counters as elements carrying an
      // ".*counter" / ".*unread" class with a number. Sum the visible ones in
      // the app navigation. This is intentionally forgiving.
      const selectors = [
        '.app-navigation-entry-utils-counter',
        '.unread-counter',
        '.icon-talk .counter',
        '#notifications .notifications-button .counter',
      ];
      const seen = new Set();
      for (const sel of selectors) {
        document.querySelectorAll(sel).forEach((el) => {
          if (seen.has(el)) return;
          seen.add(el);
          const n = parseInt((el.textContent || '').replace(/[^\d]/g, ''), 10);
          if (!Number.isNaN(n)) total += n;
        });
      }
    } catch (_) {
      return 0;
    }
    return total;
  }

  function tick() {
    try {
      const count = readUnreadCount();
      if (count !== lastCount) {
        lastCount = count;
        // Forward to the host page, which relays it to the main process.
        ipcRenderer.sendToHost('badge', count);
      }
    } catch (_) {
      /* never throw from the page */
    }
  }

  function start() {
    // Poll gently; the badge is a convenience, not a core feature.
    setInterval(tick, 5000);
    setTimeout(tick, 2500);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    start();
  } else {
    window.addEventListener('DOMContentLoaded', start);
  }
})();
