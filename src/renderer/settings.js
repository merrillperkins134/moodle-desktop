'use strict';

const urlInput = document.getElementById('serverUrl');
const selfSignedInput = document.getElementById('allowSelfSigned');
const configPathEl = document.getElementById('config-path');
const envNote = document.getElementById('env-note');

(async function init() {
  try {
    const cfg = await window.api.getConfig();
    urlInput.value = cfg.serverUrl || '';
    selfSignedInput.checked = Boolean(cfg.allowSelfSigned);
    configPathEl.textContent = cfg.configFilePath || '';
    if (cfg.serverUrlFromEnv) {
      envNote.hidden = false;
      urlInput.disabled = true;
    }
  } catch (err) {
    console.error('Failed to load config:', err);
  }
})();

document.getElementById('btn-cancel').addEventListener('click', () => window.api.closeSettings());

document.getElementById('btn-save').addEventListener('click', async () => {
  let url = urlInput.value.trim();
  if (url && !/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }
  await window.api.saveConfig({
    serverUrl: url,
    allowSelfSigned: selfSignedInput.checked,
  });
  window.api.closeSettings();
});

// Save on Enter, cancel on Escape.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-save').click();
  if (e.key === 'Escape') window.api.closeSettings();
});
