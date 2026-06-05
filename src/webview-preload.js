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

// ---------------------------------------------------------------------------
// 1. Report the user's installed navigation apps to the shell sidebar.
// ---------------------------------------------------------------------------
(function setupNavReporter() {
  async function fetchAndReport() {
    try {
      const resp = await fetch('/ocs/v2.php/core/navigation/apps?format=json', {
        headers: { 'OCS-APIREQUEST': 'true' },
        credentials: 'same-origin',
      });
      if (!resp.ok) return false;
      const json = await resp.json();
      const entries = json && json.ocs && json.ocs.data;
      if (!Array.isArray(entries) || entries.length === 0) return false;

      const results = await Promise.all(
        entries.map(async (entry) => {
          let iconDataUri = '';
          if (entry.icon) {
            try {
              const r = await fetch(entry.icon, { credentials: 'same-origin' });
              if (r.ok) {
                const text = await r.text();
                if (text.includes('<svg')) {
                  iconDataUri =
                    'data:image/svg+xml;base64,' +
                    btoa(unescape(encodeURIComponent(text)));
                }
              }
            } catch (_) {
              /* icon fetch is best-effort */
            }
          }
          let navPath = entry.href || '';
          try {
            navPath = new URL(entry.href, location.origin).pathname;
          } catch (_) {
            /* keep as-is */
          }
          if (navPath.length > 1 && navPath.endsWith('/')) {
            navPath = navPath.slice(0, -1);
          }
          return {
            id: entry.id,
            name: entry.name || entry.id,
            path: navPath,
            iconDataUri: iconDataUri,
            order: typeof entry.order === 'number' ? entry.order : 99,
          };
        })
      );

      results.sort((a, b) => a.order - b.order);
      ipcRenderer.sendToHost('nav-apps', results);
      return true;
    } catch (_) {
      return false;
    }
  }

  let attempts = 0;
  function tryFetch() {
    fetchAndReport().then((ok) => {
      if (!ok && ++attempts < 8) {
        setTimeout(tryFetch, 3000);
      }
    });
  }

  setTimeout(tryFetch, 800);
})();

// ---------------------------------------------------------------------------
// 2. Report an unread badge count to the host page (optional nice-to-have).
// ---------------------------------------------------------------------------
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
