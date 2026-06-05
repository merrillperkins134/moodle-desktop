'use strict';

/*
 * Shell renderer: drives the embedded <webview>, handles the loading / welcome /
 * error overlays, and relays the unread badge to the main process. App
 * navigation is provided by Nextcloud's own ribbon inside the webview — the
 * wrapper deliberately does not draw its own app list. No Node access here:
 * everything goes through window.api.
 */

const view = document.getElementById('view');
const loading = document.getElementById('loading');
const errorScreen = document.getElementById('error');
const errorDetail = document.getElementById('error-detail');
const errorUrl = document.getElementById('error-url');
const welcome = document.getElementById('welcome');
const welcomeForm = document.getElementById('welcome-form');
const welcomeUrl = document.getElementById('welcome-url');
const welcomeSelfSigned = document.getElementById('welcome-selfsigned');
const welcomeError = document.getElementById('welcome-error');

const overlays = [loading, errorScreen, welcome];

let serverUrl = 'https://cloud.example.com';
const DEFAULT_PATH = '/apps/dashboard';

function buildUrl(pathname) {
  return serverUrl + pathname;
}

function showOverlay(el) {
  overlays.forEach((o) => {
    o.hidden = o !== el;
  });
}

function hideOverlays() {
  overlays.forEach((o) => {
    o.hidden = true;
  });
}

function navigateTo(pathname) {
  hideOverlays();
  showOverlay(loading);
  view.src = buildUrl(pathname);
}

// --- Welcome / first-run setup ----------------------------------------------
welcomeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  let url = welcomeUrl.value.trim();
  if (!url) {
    welcomeError.textContent = 'Please enter your Nextcloud server address.';
    welcomeError.hidden = false;
    return;
  }
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }
  welcomeError.hidden = true;
  // Saving triggers a config:changed event from the main process, which kicks
  // off navigation to the dashboard (and hides this overlay).
  await window.api.saveConfig({
    serverUrl: url,
    allowSelfSigned: welcomeSelfSigned.checked,
  });
});

// --- Wrapper controls -------------------------------------------------------
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
  if (errorScreen.hidden && welcome.hidden) showOverlay(loading);
});

view.addEventListener('dom-ready', () => {
  if (welcome.hidden) hideOverlays();
});
view.addEventListener('did-stop-loading', () => {
  if (errorScreen.hidden && welcome.hidden) hideOverlays();
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
  if (!cfg.isConfigured) {
    showOverlay(welcome);
    return;
  }
  if (changedHost) {
    navigateTo(DEFAULT_PATH);
  } else {
    view.reload();
  }
});

// --- Boot -------------------------------------------------------------------
(async function boot() {
  showOverlay(loading);
  let configured = false;
  try {
    const cfg = await window.api.getConfig();
    serverUrl = cfg.serverUrl;
    configured = cfg.isConfigured;
    // Inject the badge-reporting preload into the page.
    if (cfg && window.api.webviewPreload) {
      view.setAttribute('preload', window.api.webviewPreload);
    }
  } catch (err) {
    console.error('Failed to load config:', err);
  }
  // First run: greet the user with the setup screen instead of a blank webview.
  if (configured) {
    navigateTo(DEFAULT_PATH);
  } else {
    showOverlay(welcome);
  }
})();
