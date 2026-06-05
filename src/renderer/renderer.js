'use strict';

/*
 * Shell renderer: drives the quick-jump sidebar and the embedded <webview>,
 * handles loading / error overlays, and relays the unread badge to the main
 * process. No Node access here — everything goes through window.api.
 */

const view = document.getElementById('view');
const loading = document.getElementById('loading');
const errorScreen = document.getElementById('error');
const errorDetail = document.getElementById('error-detail');
const errorUrl = document.getElementById('error-url');
const navButtons = Array.from(document.querySelectorAll('.nav-btn[data-path]'));

let serverUrl = 'https://cloud.example.com';
const DEFAULT_PATH = '/apps/dashboard';

function buildUrl(pathname) {
  return serverUrl + pathname;
}

function showOverlay(el) {
  [loading, errorScreen].forEach((o) => {
    o.hidden = o !== el;
  });
}

function hideOverlays() {
  loading.hidden = true;
  errorScreen.hidden = true;
}

function setActiveByPath(pathname) {
  // Highlight the button whose target path matches the current location.
  let matched = null;
  for (const btn of navButtons) {
    const p = btn.getAttribute('data-path');
    if (pathname === p || pathname.startsWith(p + '/') || pathname.startsWith(p)) {
      // Prefer the longest matching path (e.g. /apps/files over /apps).
      if (!matched || p.length > matched.getAttribute('data-path').length) {
        matched = btn;
      }
    }
  }
  navButtons.forEach((b) => b.classList.toggle('active', b === matched));
}

function navigateTo(pathname) {
  hideOverlays();
  showOverlay(loading);
  view.src = buildUrl(pathname);
}

// --- Sidebar wiring ---------------------------------------------------------
navButtons.forEach((btn) => {
  btn.addEventListener('click', () => navigateTo(btn.getAttribute('data-path')));
});

document.getElementById('btn-reload').addEventListener('click', () => view.reload());
document.getElementById('btn-settings').addEventListener('click', () => window.api.openSettings());
document.getElementById('btn-error-settings').addEventListener('click', () => window.api.openSettings());
document.getElementById('btn-retry').addEventListener('click', () => {
  showOverlay(loading);
  // If the current src is empty/about:blank, re-navigate to the default.
  const current = view.getURL && view.getURL();
  if (!current || current === 'about:blank') {
    navigateTo(DEFAULT_PATH);
  } else {
    view.reloadIgnoringCache();
  }
});

// --- Webview lifecycle ------------------------------------------------------
view.addEventListener('did-start-loading', () => {
  if (errorScreen.hidden) showOverlay(loading);
});

view.addEventListener('dom-ready', () => hideOverlays());
view.addEventListener('did-stop-loading', () => {
  if (errorScreen.hidden) hideOverlays();
});

view.addEventListener('did-navigate', (e) => {
  try {
    const u = new URL(e.url);
    setActiveByPath(u.pathname);
  } catch (_) {
    /* ignore */
  }
});

view.addEventListener('did-navigate-in-page', (e) => {
  try {
    const u = new URL(e.url);
    setActiveByPath(u.pathname);
  } catch (_) {
    /* ignore */
  }
});

view.addEventListener('did-fail-load', (e) => {
  // -3 (ABORTED) happens on normal redirects/cancelled loads — ignore it.
  if (!e.isMainFrame || e.errorCode === -3) return;
  errorDetail.textContent =
    `The server didn't respond (${e.errorDescription || 'error ' + e.errorCode}). ` +
    'Check that it is online and that your server URL is correct.';
  errorUrl.textContent = serverUrl;
  showOverlay(errorScreen);
});

// Relay the unread badge from the injected webview preload to the main process.
view.addEventListener('ipc-message', (e) => {
  if (e.channel === 'badge') {
    const count = Array.isArray(e.args) ? e.args[0] : 0;
    window.api.setBadge(count);
  }
});

// --- Main-process events ----------------------------------------------------
window.api.onReload(() => view.reload());

window.api.onConfigChanged((cfg) => {
  const changedHost = cfg.serverUrl !== serverUrl;
  serverUrl = cfg.serverUrl;
  if (changedHost) {
    navigateTo(DEFAULT_PATH);
  } else {
    view.reload();
  }
});

// --- Boot -------------------------------------------------------------------
(async function boot() {
  showOverlay(loading);
  try {
    const cfg = await window.api.getConfig();
    serverUrl = cfg.serverUrl;
    // Inject the badge-reporting preload into the page.
    if (cfg && window.api.webviewPreload) {
      view.setAttribute('preload', window.api.webviewPreload);
    }
  } catch (err) {
    console.error('Failed to load config:', err);
  }
  navigateTo(DEFAULT_PATH);
})();
