# Tauri Self-Contained Desktop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-contained Tauri desktop app that launches WhatsApp Command Center without a terminal, embeds the existing dashboard, supports QR onboarding and visual group selection, and can package the Node backend with the desktop app.

**Architecture:** Tauri v2 starts a bundled Node runtime sidecar. The sidecar runs the existing backend from bundled resources, uses desktop app-data paths, emits JSON readiness events, and serves the dashboard/onboarding UI on loopback. The CLI remains supported by calling the same runtime with terminal setup enabled.

**Tech Stack:** Node.js ESM, node:test, Baileys, Tauri v2, Rust, tauri-plugin-shell, tauri-plugin-opener.

## Global Constraints

- Keep `npm start`, `npm start -- --setup`, and `npm start -- --rescan` working.
- Desktop mode must bind the dashboard server to `127.0.0.1`.
- Desktop mutable data must use `WACC_DATA_DIR`/app-data paths, not the installed app resource directory.
- Tauri must start the backend without requiring users to install Node.js or npm.
- The dashboard must be available inside the app and through an Open in Browser action.
- Add automated tests for behavior that does not require real WhatsApp credentials.
- Preserve existing settings, dashboard, media, keyword, pulse, and group PIN behavior.

---

### Task 1: Config Paths And Server Listen Contract

**Files:**
- Modify: `package.json`
- Modify: `src/config-store.js`
- Modify: `src/dashboard-server.js`
- Create: `test/config-store.test.js`
- Create: `test/dashboard-server.test.js`

**Interfaces:**
- Produces: `getDataDir()`, `getConfigPath()`, `createDashboardServer({ host, port, ... }).ready`, `dashboard.url`, and `dashboard.address()`.

- [ ] **Step 1: Write failing tests**
- [ ] **Step 2: Verify tests fail**
- [ ] **Step 3: Implement minimal support**
- [ ] **Step 4: Verify tests pass**
- [ ] **Step 5: Commit**

### Task 2: Web Onboarding APIs And UI

**Files:**
- Modify: `src/dashboard-server.js`
- Modify: `src/whatsapp.js`
- Create: `test/onboarding-routes.test.js`

**Interfaces:**
- Consumes: Task 1 dashboard listen contract.
- Produces: `/onboarding`, `/api/desktop/status`, `/api/setup/qr.png`, `/api/groups/refresh`, `/api/onboarding/groups`, `/api/desktop/rescan`, `/api/desktop/logout`, and setup WebSocket event broadcasts.

- [ ] **Step 1: Write failing route tests**
- [ ] **Step 2: Verify tests fail**
- [ ] **Step 3: Implement routes and onboarding page**
- [ ] **Step 4: Verify tests pass**
- [ ] **Step 5: Commit**

### Task 3: Runtime Refactor And Desktop Sidecar Entry

**Files:**
- Create: `src/app-runtime.js`
- Modify: `src/index.js`
- Modify: `src/setup.js`
- Modify: `src/whatsapp.js`
- Create: `src/desktop-sidecar.js`
- Create: `test/app-runtime.test.js`

**Interfaces:**
- Consumes: Task 2 onboarding callbacks.
- Produces: `startCommandCenter(options)`, CLI `main()`, and desktop sidecar JSON stdout events with `{ "type": "ready", "url": "http://127.0.0.1:<port>" }`.

- [ ] **Step 1: Write failing runtime tests**
- [ ] **Step 2: Verify tests fail**
- [ ] **Step 3: Implement runtime split**
- [ ] **Step 4: Add desktop sidecar entry**
- [ ] **Step 5: Verify tests pass**
- [ ] **Step 6: Commit**

### Task 4: Tauri Shell, Bundled Node Runtime, And Resources

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.gitignore`
- Create: `desktop/index.html`
- Create: `scripts/prepare-tauri-sidecar.js`
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/build.rs`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/capabilities/default.json`
- Create: `src-tauri/src/main.rs`

**Interfaces:**
- Consumes: `src/desktop-sidecar.js` and JSON `ready` stdout events.
- Produces: `npm run desktop:dev`, `npm run desktop:build`, `npm run desktop:prepare`, and Tauri app packaging config.

- [ ] **Step 1: Write failing smoke checks**
- [ ] **Step 2: Implement desktop shell and prepare script**
- [ ] **Step 3: Implement Rust sidecar lifecycle**
- [ ] **Step 4: Verify desktop checks**
- [ ] **Step 5: Commit**

### Task 5: Documentation, Build Verification, And Final Review

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: user-facing instructions for desktop development/build and cross-platform packaging requirements.

- [ ] **Step 1: Update README**
- [ ] **Step 2: Run full verification**
- [ ] **Step 3: Commit**
- [ ] **Step 4: Final review**
