# Tauri Self-Contained Desktop Design

## Overview

WhatsApp Command Center will gain a self-contained Tauri desktop app for macOS, Windows, and Linux. The desktop app will launch without a terminal, start the existing Node/Baileys backend as a bundled sidecar, show the dashboard inside the app window, and offer a button to open the same local dashboard in the system browser.

The design keeps the current Node WhatsApp implementation as the source of truth. Rewriting the WhatsApp layer in Rust is out of scope because Baileys already provides the working WhatsApp integration and the existing dashboard/server code is small enough to adapt safely.

## Goals

- Package a desktop app that users can launch directly instead of running `npm start` in a terminal.
- Bundle the backend so normal users do not need to install Node.js or npm.
- Support macOS, Windows, and Linux packaging through Tauri.
- Preserve the existing browser dashboard and settings behavior.
- Add in-app onboarding for QR scan and visual group selection.
- Add in-app controls to logout/rescan WhatsApp and refresh group discovery.
- Keep the CLI path working for users who still prefer terminal usage.

## Non-Goals

- Publishing signed/notarized production installers in this first implementation.
- Replacing Baileys or moving WhatsApp connectivity into Rust.
- Adding cloud sync, hosted services, or remote dashboard access.
- Changing the dashboard's core message filtering and pulse behavior beyond what onboarding needs.

## Architecture

The desktop app will use Tauri v2 as a shell around the local web experience. Tauri starts a bundled backend sidecar, waits until it reports a dashboard URL, and loads that URL in the main webview. The backend remains responsible for WhatsApp authentication, group listing, message ingestion, config persistence, HTTP routes, and WebSocket updates.

The backend will gain a programmatic entry point so it can be used by both `src/index.js` and a sidecar launcher. The sidecar launcher will run in desktop mode, use app-data paths provided by Tauri, bind to `127.0.0.1`, and emit machine-readable lifecycle events to stdout so Tauri can detect readiness.

## Components

### Tauri Shell

The Tauri shell will live under `src-tauri/`. It will:

- Start the bundled backend sidecar during app setup.
- Pass environment variables for app-data directory, host, port behavior, and desktop mode.
- Read sidecar stdout for JSON readiness and error events.
- Navigate the main window to the backend URL after readiness.
- Provide commands to open the backend URL in the system browser.
- Stop the sidecar when the desktop app exits.

The first app version can use Tauri's generated frontend shell as a loading screen. Once the backend is ready, the webview navigates to the local dashboard URL.

### Node Backend

The Node backend will be split so startup logic is reusable:

- A reusable app runtime starts config, dashboard server, WhatsApp bridge, setup coordinator, and shutdown handling.
- The existing CLI entry point calls the runtime with terminal setup enabled.
- The desktop sidecar entry point calls the runtime with web onboarding enabled and automatic browser opening disabled.

The runtime will return server metadata, including host, selected port, dashboard URL, and shutdown handles.

### Web Onboarding

The dashboard server will add an onboarding route for incomplete setup and rescan flows. In desktop mode, the app should not block in terminal prompts. Instead, users will interact with browser-based onboarding screens:

- QR scan screen showing the latest generated QR image.
- Connection status while waiting for WhatsApp login.
- Group discovery status after login.
- Searchable visual group picker using checkboxes.
- Save action that writes watched groups and moves to the dashboard.

If a user opens the same local URL in the browser during onboarding, the browser should show the same screens.

### Dashboard And Settings

The existing dashboard remains available at `/`. The existing settings page remains available at `/settings`. Group management in settings will continue to support PIN protection.

The desktop app will add or expose controls for:

- Open in Browser.
- Logout and rescan QR.
- Refresh group list.

These controls can be implemented as backend routes plus lightweight UI buttons in the dashboard/settings/onboarding pages.

## Backend API Additions

The dashboard server will add local-only JSON routes:

- `GET /api/desktop/status`: returns setup status, connection status, selected dashboard URL data, watched group count, and whether onboarding is required.
- `POST /api/desktop/rescan`: clears WhatsApp auth, starts web onboarding, and publishes a new QR when available.
- `POST /api/desktop/logout`: clears WhatsApp auth and marks onboarding required.
- `POST /api/groups/refresh`: fetches participating WhatsApp groups and updates `knownGroups`.
- `POST /api/onboarding/groups`: saves selected watched groups and exits onboarding.

WebSocket broadcasts will gain setup events:

- `setup-status`: setup phase updates such as `waiting_for_qr`, `waiting_for_scan`, `connected`, `fetching_groups`, `ready`, and `error`.
- `qr-updated`: emitted when a new QR PNG is written and available to the UI.
- `groups-updated`: emitted when group discovery completes.

The existing `/api/state`, `/api/settings`, `/api/groups/unlock`, `/ws`, and media routes remain stable.

## QR Handling

The WhatsApp setup helper will expose QR updates through a callback that writes the PNG and notifies the server. Terminal mode can continue printing the QR code. Desktop mode will not depend on terminal output.

The onboarding UI will show the QR image from a local route such as `/api/setup/qr.png`. The route will serve the current QR image from the configured data directory and use no-store caching headers so rescans update reliably.

## Data Storage

Mutable data will move behind configurable paths:

- Config JSON.
- Baileys auth session.
- QR image.
- Media downloads.
- Logs.

For CLI usage without environment overrides, the existing repo-local paths can remain as the default to preserve current behavior. For desktop usage, Tauri passes an app-data directory so installed app bundles do not try to write into read-only install locations.

Desktop data path examples:

- macOS: `~/Library/Application Support/WhatsApp Command Center`
- Windows: `%APPDATA%/WhatsApp Command Center`
- Linux: `~/.local/share/whatsapp-command-center`

## Local Server Security

Desktop mode will bind the dashboard server to `127.0.0.1`, not `0.0.0.0`. The port can remain `3399` by default, but the runtime should support port `0` or fallback port selection for desktop mode if the default port is occupied.

A lightweight local token can be added after the base desktop flow works. For this first self-contained implementation, the security floor is loopback binding, no remote network binding in desktop mode, and no shell execution exposed through HTTP.

## Packaging

Tauri will package the desktop app and include the Node backend sidecar through `bundle.externalBin`. The sidecar must exist with target-triple-specific names for each target platform, following Tauri v2 sidecar conventions.

The build process will produce sidecar executables from the Node backend before invoking Tauri packaging. The preferred implementation is to bundle the Node source into a single backend entry and package it into platform executables. If the selected Node executable bundler cannot reliably handle the Baileys dependency tree, the fallback is to ship a Node runtime plus backend files as a Tauri sidecar resource set.

## Scripts

Package scripts will be added for:

- Development desktop launch.
- Building the backend sidecar for the current platform.
- Building desktop bundles for the current platform.
- Running existing Node syntax checks.

The existing `npm start`, `npm start -- --setup`, and `npm start -- --rescan` flows will continue to work.

## Error Handling

If the sidecar fails to start, Tauri will keep the loading screen visible and show an actionable startup error. If the backend starts but WhatsApp needs login, the UI will show onboarding rather than exiting. If group discovery fails, onboarding will show the error and provide retry/rescan actions.

If the configured port is unavailable in desktop mode, the backend should choose an available loopback port and emit that URL to Tauri. In CLI mode, the current explicit error message for an occupied configured port can remain.

## Testing

Automated coverage will focus on behavior that can be verified without real WhatsApp credentials:

- Config paths honor desktop app-data environment variables.
- Dashboard server serves onboarding/status routes.
- Settings and group update routes preserve existing behavior.
- Runtime startup emits readiness metadata when WhatsApp is mocked or disabled for tests.
- Desktop-mode server binds to loopback host configuration.
- Existing syntax check still passes.

Manual verification will cover:

- Tauri dev app opens a desktop window.
- Backend sidecar starts without a visible terminal.
- QR appears in onboarding during rescan.
- Groups can be selected visually after WhatsApp login.
- Dashboard displays inside the app window.
- Open in Browser opens the same dashboard URL externally.

## Rollout Order

1. Refactor config paths and runtime startup without changing CLI behavior.
2. Add web onboarding APIs and UI while keeping terminal setup available.
3. Add Tauri shell that starts the backend in development mode.
4. Add sidecar build and Tauri bundle configuration.
5. Verify current-platform desktop development and document cross-platform build requirements.

## Open Decisions Resolved

- The implementation will use a bundled Node sidecar rather than a Rust rewrite.
- The desktop app will reuse the local web dashboard instead of building a separate native UI.
- CLI behavior will remain supported.
- Signing and notarization are not required for the first implementation.
