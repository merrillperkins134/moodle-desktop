'use strict';

const path = require('path');
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  shell,
  session,
  ipcMain,
  nativeImage,
  Notification,
} = require('electron');

const config = require('./config');

// Persistent session partition: cookies, localStorage, service workers and
// IndexedDB are all written to disk so the login survives restarts. The same
// string is used on the <webview partition="..."> attribute in the renderer.
const PARTITION = 'persist:nextcloud';

// A desktop browser user-agent so Nextcloud serves the full Hub UI (not mobile).
const DESKTOP_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36';

const ASSETS_DIR = path.join(__dirname, '..', 'assets');

let mainWindow = null;
let settingsWindow = null;
let tray = null;
let isQuitting = false;
let saveStateTimer = null;

// Single-instance: focus the existing window instead of launching a second copy.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
  });
  bootstrap();
}

function bootstrap() {
  app.whenReady().then(() => {
    configureSession();
    createMainWindow();
    createTray();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      } else {
        showMainWindow();
      }
    });
  });

  // Closing all windows must NOT quit — we live in the tray. Only an explicit
  // Quit (which sets isQuitting) ends the app.
  app.on('window-all-closed', (e) => {
    if (!isQuitting) {
      e.preventDefault();
    }
  });

  app.on('before-quit', () => {
    isQuitting = true;
  });

  // Trust self-signed certificates only when the user opts in, and only for the
  // configured Nextcloud host.
  app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
    const cfg = config.getConfig();
    let host = '';
    try {
      host = new URL(url).host;
    } catch (_) {
      /* ignore */
    }
    if (cfg.allowSelfSigned && host && host === config.getServerHost()) {
      event.preventDefault();
      callback(true);
    } else {
      callback(false);
    }
  });

  // Apply the desktop user-agent and external-link handling to every webview.
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() === 'webview') {
      wireWebview(contents);
    }
  });

  registerIpc();
}

function configureSession() {
  const ses = session.fromPartition(PARTITION);

  ses.setUserAgent(DESKTOP_UA);

  // Auto-grant notifications + media (Talk needs camera/mic) for our own origin,
  // deny everything else. No prompts inside the app.
  const isOwnOrigin = (requestingOrigin) => {
    const origin = config.getServerOrigin();
    return origin && requestingOrigin && requestingOrigin.startsWith(origin);
  };
  const allowedPermissions = new Set([
    'notifications',
    'media',
    'mediaKeySystem',
    'fullscreen',
    'clipboard-read',
    'clipboard-sanitized-write',
  ]);

  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const origin = (details && details.requestingUrl) || (webContents && webContents.getURL());
    if (allowedPermissions.has(permission) && isOwnOrigin(origin)) {
      return callback(true);
    }
    return callback(false);
  });

  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    return allowedPermissions.has(permission) && isOwnOrigin(requestingOrigin);
  });
}

function createMainWindow() {
  const state = config.getWindowState() || {};
  const bounds = {
    width: state.width || 1280,
    height: state.height || 860,
  };
  if (typeof state.x === 'number' && typeof state.y === 'number') {
    bounds.x = state.x;
    bounds.y = state.y;
  }

  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 800,
    minHeight: 600,
    title: 'Nextcloud Desktop',
    backgroundColor: '#0b0c0f',
    icon: path.join(ASSETS_DIR, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
      // The <webview> uses the persistent partition (set as an attribute), so we
      // keep the partition reference here for clarity.
      partition: PARTITION,
    },
  });

  if (state.maximized) {
    mainWindow.maximize();
  }

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('resize', persistWindowStateDebounced);
  mainWindow.on('move', persistWindowStateDebounced);

  // Close => hide to tray (unless the user chose Quit).
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      persistWindowState();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function persistWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const maximized = mainWindow.isMaximized();
  // When maximized, keep the previous "normal" bounds for restore.
  const bounds = maximized ? mainWindow.getNormalBounds() : mainWindow.getBounds();
  config.saveWindowState({ ...bounds, maximized });
}

function persistWindowStateDebounced() {
  clearTimeout(saveStateTimer);
  saveStateTimer = setTimeout(persistWindowState, 400);
}

function showMainWindow() {
  if (!mainWindow) {
    createMainWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function toggleMainWindow() {
  if (mainWindow && mainWindow.isVisible() && !mainWindow.isMinimized()) {
    mainWindow.hide();
  } else {
    showMainWindow();
  }
}

// --- Webview behaviour ------------------------------------------------------
function isInternalUrl(url) {
  const origin = config.getServerOrigin();
  if (!origin) return false;
  try {
    return new URL(url).origin === origin;
  } catch (_) {
    return false;
  }
}

function openExternal(url) {
  if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url)) {
    shell.openExternal(url).catch((err) => console.error('openExternal failed:', err.message));
  }
}

function wireWebview(contents) {
  // New windows / target=_blank: keep internal navigations in-app, send the
  // rest to the system browser.
  contents.setWindowOpenHandler(({ url }) => {
    if (isInternalUrl(url)) {
      // Load it in the same webview rather than spawning a window.
      contents.loadURL(url);
    } else {
      openExternal(url);
    }
    return { action: 'deny' };
  });

  // Top-level navigations to an external host go to the system browser.
  contents.on('will-navigate', (event, url) => {
    if (!isInternalUrl(url)) {
      event.preventDefault();
      openExternal(url);
    }
  });
}

// --- Tray -------------------------------------------------------------------
function createTray() {
  const trayIcon = nativeImage.createFromPath(path.join(ASSETS_DIR, 'tray.png'));
  tray = new Tray(trayIcon);
  tray.setToolTip('Nextcloud Desktop');
  rebuildTrayMenu();

  tray.on('click', () => toggleMainWindow());
}

function rebuildTrayMenu(badgeCount) {
  if (!tray) return;
  const items = [
    {
      label: 'Show / Hide',
      click: () => toggleMainWindow(),
    },
    {
      label: 'Reload',
      click: () => {
        if (mainWindow) mainWindow.webContents.send('action:reload');
      },
    },
    { type: 'separator' },
    {
      label: 'Settings…',
      click: () => openSettingsWindow(),
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ];

  if (badgeCount && badgeCount > 0) {
    items.unshift(
      { label: `${badgeCount} unread`, enabled: false },
      { type: 'separator' }
    );
  }

  tray.setContextMenu(Menu.buildFromTemplate(items));
}

// --- Settings window --------------------------------------------------------
function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 520,
    height: 420,
    parent: mainWindow || undefined,
    modal: Boolean(mainWindow),
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'Settings — Nextcloud Desktop',
    backgroundColor: '#1b1d22',
    autoHideMenuBar: true,
    icon: path.join(ASSETS_DIR, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  settingsWindow.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

// --- IPC --------------------------------------------------------------------
function registerIpc() {
  ipcMain.handle('config:get', () => config.getConfig());

  ipcMain.handle('config:save', (_event, partial) => {
    const updated = config.saveConfig(partial || {});
    // Re-apply UA / permission handlers against the (possibly) new origin.
    configureSession();
    // Tell the main window to reload the embedded view with the new settings.
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('config:changed', updated);
    }
    return updated;
  });

  ipcMain.on('settings:open', () => openSettingsWindow());

  ipcMain.on('settings:close', () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close();
  });

  // Unread badge coming from the webview preload (best-effort / optional).
  ipcMain.on('badge:set', (_event, count) => {
    const n = Number(count) || 0;
    if (typeof app.setBadgeCount === 'function') {
      try {
        app.setBadgeCount(n);
      } catch (_) {
        /* not supported on all DEs */
      }
    }
    if (tray) {
      tray.setToolTip(n > 0 ? `Nextcloud Desktop — ${n} unread` : 'Nextcloud Desktop');
    }
    rebuildTrayMenu(n);
  });

  // Allow the renderer to bounce a notification through the native system if
  // the in-page Notification API is unavailable for any reason.
  ipcMain.on('notify', (_event, { title, body }) => {
    if (Notification.isSupported()) {
      const n = new Notification({
        title: title || 'Nextcloud',
        body: body || '',
        icon: path.join(ASSETS_DIR, 'icon.png'),
      });
      n.on('click', () => showMainWindow());
      n.show();
    }
  });
}
