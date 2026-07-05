# WhatsApp Command Center

Big-screen WhatsApp display for production teams.

## What it does

- Connects to WhatsApp using Baileys.
- On first run, guides you through QR setup and selecting groups to watch.
- Runs a local dashboard in the browser and streams new group messages live over WebSocket.
- New messages trigger red screen flashing until you stop it (button or `s` key).
- Includes fullscreen mode and optional keyword-only display filtering.

## Run

```bash
cd whatsapp-command-center
npm install
npm start
```

On startup, the dashboard runs at [http://localhost:3399](http://localhost:3399) by default.

Re-run setup anytime (including searchable group picker):

```bash
npm start -- --setup
```

If the app loses connection to WhatsApp (e.g. dashboard still says "Connected" but messages stop, or you see decrypt/session errors in the log), re-link by rescanning the QR code:

```bash
npm start -- --rescan
```

Or with the global command: `whatsappCC --rescan`. This clears the WhatsApp session and runs setup again so you can scan a fresh QR and pick groups.

## Desktop app

The Tauri desktop app launches the command center without a terminal. It starts a bundled Node runtime sidecar, stores desktop data in the OS app-data folder, shows QR onboarding in the app window, and can open the same local dashboard in your browser.

Run the desktop app in development:

```bash
npm run desktop:dev
```

Prepare the bundled backend resources and current-platform Node sidecar:

```bash
npm run desktop:prepare
```

Check the Tauri/Rust shell without launching the app:

```bash
npm run desktop:check
```

Build a self-contained desktop bundle for the current platform:

```bash
npm run desktop:build
```

By default, `desktop:build` creates the stable bundle type for the current OS: `.app` on macOS, NSIS on Windows, and AppImage on Linux. To ask Tauri for another bundle type, set `WACC_TAURI_BUNDLES`, for example:

```bash
WACC_TAURI_BUNDLES=dmg npm run desktop:build
```

For macOS, Windows, and Linux release artifacts, run the build on each target OS or in matching CI runners. The prepare step creates the correct Tauri sidecar name for the active Rust target triple, such as `wacc-node-aarch64-apple-darwin` on Apple Silicon Macs.

## Installed command (background mode)

If installed as a package, run:

```bash
whatsappCC
```

This starts the app in the background and writes logs to `whatsapp-command-center.log`.

Run in foreground instead:

```bash
whatsappCC --foreground
```

## Behavior

- Default: shows all messages from selected groups.
- Optional keyword mode: open [http://localhost:3399/settings](http://localhost:3399/settings), enable **Only show keyword matches**, add comma-separated keywords, then save.
- In keyword mode, only matching messages are displayed on the dashboard stream.
- Settings page also includes:
  - pulse enable/disable
  - pulse mode: `all messages` or `keyword matches`
  - dedicated pulse keywords (separate from display filter keywords)
  - message font size
  - group enable/disable checkboxes
  - per-group keyword inputs (override global keywords for that group)
  - group search by name
  - optional PIN lock for group management (unlock required before group list is shown)
- Home dashboard header shows watched group names (not only the count).

## Notes

- `wa-qr.png` is generated during setup for easy scanning.
- Config is saved at `whatsapp-command-center/data/config.json`.
- Set `WACC_OPEN_DASHBOARD=0` to disable automatic browser open.
