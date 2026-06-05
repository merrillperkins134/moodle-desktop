# Nextcloud Desktop

A lean, native desktop wrapper for your **self-hosted Nextcloud Hub** — use
Files, Mail, Calendar, Talk, Contacts, Deck and the Dashboard in a dedicated
window with a quick-jump sidebar, system tray and native GNOME notifications,
instead of living in a browser tab.

Built with Electron + electron-builder. Targets **Zorin OS 17**
(Ubuntu 22.04 / GNOME, x86_64). No telemetry, no analytics, no external calls
beyond your own Nextcloud server.

---

## Features

- Single window embedding the full **desktop** Nextcloud Hub UI (desktop
  user-agent, not the mobile layout).
- **Quick-jump sidebar** (rendered natively, outside the web view) for
  Dashboard, Files, Mail, Calendar, Talk, Contacts and Deck, with the active
  section highlighted, plus **Reload** and **Settings** buttons.
- **Persistent login** — cookies, localStorage and service workers are written
  to disk in a persistent session partition, so you stay signed in across
  restarts.
- **System tray** with Show/Hide, Reload, Settings and Quit. Closing the window
  minimizes to the tray; only **Quit** fully exits.
- **Native notifications** — Talk messages, Mail and Calendar reminders appear
  in GNOME. The Notifications (and camera/mic for Talk calls) permission is
  auto-granted for your own server only.
- **External links** (anything off your Nextcloud domain) open in your system
  default browser — never inside the app.
- Remembers and restores **window size/position**.
- Friendly **retry screen** if the server is unreachable, instead of a blank
  window.
- Optional unread **badge** on the tray tooltip / launcher if Nextcloud exposes
  a counter (best-effort; silently skipped if unavailable).

---

## Prerequisites (Zorin OS 17 / Ubuntu 22.04)

You only need Node.js to develop or build. The packaged `.deb`/AppImage bundle
their own runtime.

```bash
# Node.js 18+ (via NodeSource, or use nvm)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Build/runtime libraries Electron needs on a GNOME desktop
sudo apt-get install -y libnotify4 libnss3 libatk-bridge2.0-0 libgtk-3-0 \
  libgbm1 libasound2
```

Then install the project dependencies:

```bash
npm install
```

---

## Set your server URL

The app reads its configuration from a JSON file created on first run, so you
can change the server **without rebuilding**.

**Config file location** (created automatically the first time you launch):

```
~/.config/nextcloud-desktop/config.json
```

Example:

```json
{
  "serverUrl": "https://cloud.mydomain.tld",
  "allowSelfSigned": false
}
```

- `serverUrl` — your Nextcloud base URL (default placeholder:
  `https://cloud.example.com`).
- `allowSelfSigned` — set to `true` only if your server uses a self-signed /
  untrusted TLS certificate. Default `false`.

You can also set the URL in three other ways:

1. **In-app:** click the ⚙ **Settings** button in the sidebar (or the tray
   menu), enter the URL, and Save & Reload.
2. **Environment variable** (overrides the config file, not persisted):

   ```bash
   NEXTCLOUD_URL="https://cloud.mydomain.tld" npm start
   ```

3. Edit `config.json` directly and restart the app.

---

## Run in development

```bash
npm start
```

This launches the app with Electron against your current config.

To point it at a server for a one-off dev run:

```bash
NEXTCLOUD_URL="https://cloud.mydomain.tld" npm start
```

---

## Build the installers

Produces **both** a `.deb` and an **AppImage** for x86_64 in `dist-build/`:

```bash
npm run dist
```

(The icons are regenerated automatically before each build via the `predist`
step. To regenerate them manually: `npm run generate-icons`.)

Artifacts land in:

```
dist-build/nextcloud-desktop_1.0.0_amd64.deb
dist-build/Nextcloud Desktop-1.0.0-x86_64.AppImage
```

---

## Install the .deb on Zorin

```bash
sudo apt install ./dist-build/nextcloud-desktop_1.0.0_amd64.deb
```

(or double-click it in Files to open it with the Software installer.)

After installing, **Nextcloud Desktop** appears in the Zorin application menu
under **Internet / Network**. Launch it, open Settings, set your server URL, and
log in.

To run the AppImage instead (no install needed):

```bash
chmod +x "dist-build/Nextcloud Desktop-1.0.0-x86_64.AppImage"
"./dist-build/Nextcloud Desktop-1.0.0-x86_64.AppImage"
```

To uninstall the `.deb`:

```bash
sudo apt remove nextcloud-desktop
```

---

## Project structure

```
.
├── package.json            # deps, npm scripts, electron-builder config
├── scripts/
│   └── generate-icons.js   # dependency-free placeholder icon generator
├── build/
│   └── icon.png            # 512x512 icon used by electron-builder
├── assets/
│   ├── icon.png            # runtime window icon
│   └── tray.png            # system tray icon
└── src/
    ├── main.js             # main process: window, tray, session, IPC
    ├── preload.js          # context-bridge API for the shell + settings UI
    ├── webview-preload.js  # injected into Nextcloud page (badge reporting)
    ├── config.js           # config + window-state persistence
    └── renderer/
        ├── index.html      # shell: sidebar + <webview> + overlays
        ├── renderer.js     # sidebar logic, navigation, error handling
        ├── styles.css      # shell + settings styling
        ├── settings.html   # settings dialog
        └── settings.js     # settings dialog logic
```

---

## Notes

- The placeholder icon is generated programmatically (a blue square with a white
  cloud). Replace `assets/icon.png`, `assets/tray.png` and `build/icon.png` with
  your own branding if you like — keep the same dimensions (512×512 and 64×64).
- This app makes no network calls of its own. The only traffic is your browser
  session talking to your Nextcloud server.

## License

MIT
