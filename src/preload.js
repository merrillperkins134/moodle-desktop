'use strict';

/*
 * Preload for the shell renderer (the page hosting the sidebar + <webview>)
 * and the settings window. Exposes a tiny, explicit API over the context
 * bridge — no Node access leaks into page content.
 */

const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

contextBridge.exposeInMainWorld('api', {
  // Absolute file:// URL of the preload to inject into the <webview>.
  webviewPreload: pathToFileURL(path.join(__dirname, 'webview-preload.js')).toString(),

  // Config
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (partial) => ipcRenderer.invoke('config:save', partial),
  onConfigChanged: (cb) => {
    const listener = (_event, cfg) => cb(cfg);
    ipcRenderer.on('config:changed', listener);
    return () => ipcRenderer.removeListener('config:changed', listener);
  },

  // Settings window
  openSettings: () => ipcRenderer.send('settings:open'),
  closeSettings: () => ipcRenderer.send('settings:close'),

  // Tray reload trigger (main -> renderer)
  onReload: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('action:reload', listener);
    return () => ipcRenderer.removeListener('action:reload', listener);
  },

  // Unread badge (renderer -> main)
  setBadge: (count) => ipcRenderer.send('badge:set', count),

  // Native notification fallback
  notify: (payload) => ipcRenderer.send('notify', payload),
});
