'use strict';

/*
 * Configuration handling.
 *
 * The config lives in a JSON file in the app's userData directory so it can be
 * edited without rebuilding the app. It is created on first run with sensible
 * defaults. The NEXTCLOUD_URL environment variable overrides the stored URL.
 *
 * Window position/size is kept in a separate window-state.json so user-editable
 * settings stay clean and obvious.
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULT_CONFIG = Object.freeze({
  // Placeholder — change this to your own Nextcloud server.
  serverUrl: 'https://cloud.example.com',
  // Trust self-signed / untrusted TLS certificates from the server. Default off.
  allowSelfSigned: false,
});

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function windowStatePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function normalizeUrl(url) {
  if (typeof url !== 'string') return DEFAULT_CONFIG.serverUrl;
  // Strip trailing slashes so we can safely append "/apps/...".
  return url.trim().replace(/\/+$/, '');
}

let cache = null;

function readConfig() {
  if (cache) return cache;

  let stored = {};
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    stored = JSON.parse(raw);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('Failed to read config, using defaults:', err.message);
    }
    // First run (or unreadable) — create the file with defaults.
    stored = {};
  }

  const merged = {
    ...DEFAULT_CONFIG,
    ...stored,
    serverUrl: normalizeUrl(stored.serverUrl || DEFAULT_CONFIG.serverUrl),
    allowSelfSigned: Boolean(stored.allowSelfSigned),
  };

  // Ensure the file exists on disk for the user to edit.
  if (!fs.existsSync(configPath())) {
    writeConfig(merged);
  }

  cache = merged;
  return cache;
}

function writeConfig(config) {
  try {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to write config:', err.message);
  }
}

function getConfig() {
  const config = { ...readConfig() };
  // Env var override takes precedence at read time but is not persisted.
  if (process.env.NEXTCLOUD_URL) {
    config.serverUrl = normalizeUrl(process.env.NEXTCLOUD_URL);
    config.serverUrlFromEnv = true;
  }
  config.configFilePath = configPath();
  return config;
}

function saveConfig(partial) {
  const current = readConfig();
  const next = {
    ...current,
    ...partial,
    serverUrl: normalizeUrl(partial.serverUrl != null ? partial.serverUrl : current.serverUrl),
    allowSelfSigned:
      partial.allowSelfSigned != null ? Boolean(partial.allowSelfSigned) : current.allowSelfSigned,
  };
  // Don't persist derived/runtime-only fields.
  delete next.serverUrlFromEnv;
  delete next.configFilePath;
  cache = next;
  writeConfig(next);
  return getConfig();
}

function getServerUrl() {
  return getConfig().serverUrl;
}

function getServerHost() {
  try {
    return new URL(getServerUrl()).host;
  } catch (err) {
    return '';
  }
}

function getServerOrigin() {
  try {
    return new URL(getServerUrl()).origin;
  } catch (err) {
    return '';
  }
}

// --- Window state -----------------------------------------------------------
function getWindowState() {
  try {
    return JSON.parse(fs.readFileSync(windowStatePath(), 'utf8'));
  } catch (err) {
    return null;
  }
}

function saveWindowState(state) {
  try {
    fs.mkdirSync(path.dirname(windowStatePath()), { recursive: true });
    fs.writeFileSync(windowStatePath(), JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to write window state:', err.message);
  }
}

module.exports = {
  DEFAULT_CONFIG,
  getConfig,
  saveConfig,
  getServerUrl,
  getServerHost,
  getServerOrigin,
  getWindowState,
  saveWindowState,
  configPath,
};
