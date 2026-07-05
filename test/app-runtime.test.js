import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { startCommandCenter } from "../src/app-runtime.js"

test("desktop runtime starts loopback dashboard without terminal setup", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "wacc-runtime-"))
  const events = []
  const app = await startCommandCenter({
    args: [],
    dataDir: tempDir,
    desktop: true,
    host: "127.0.0.1",
    port: 0,
    openDashboard: false,
    onEvent: (event) => events.push(event),
    services: {
      runFirstSetup: async () => {
        throw new Error("terminal setup should not run in desktop mode")
      },
      resetWhatsAppSession: async () => {},
      setupWhatsAppSession: async ({ onQr }) => {
        await onQr("qr-code")
      },
      listWhatsAppGroups: async () => [{ id: "ops@g.us", name: "Ops" }],
      WhatsAppBridge: class FakeBridge {
        async start() {}
        async waitUntilReady() {}
        async stop() {}
      },
    },
  })

  try {
    assert.match(app.url, /^http:\/\/127\.0\.0\.1:\d+$/)
    assert.equal(events.some((event) => event.type === "ready" && event.url === app.url), true)

    const status = await fetch(`${app.url}/api/desktop/status`).then((res) => res.json())
    assert.equal(status.onboardingRequired, true)
    assert.equal(status.state.connected, false)
  } finally {
    await app.shutdown()
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("desktop rescan route returns while QR setup is still pending", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "wacc-runtime-rescan-"))
  const app = await startCommandCenter({
    args: [],
    dataDir: tempDir,
    desktop: true,
    host: "127.0.0.1",
    port: 0,
    openDashboard: false,
    services: {
      runFirstSetup: async () => {
        throw new Error("terminal setup should not run in desktop mode")
      },
      resetWhatsAppSession: async () => {},
      setupWhatsAppSession: async ({ onQr }) => {
        await onQr("qr-code")
        return new Promise(() => {})
      },
      listWhatsAppGroups: async () => [{ id: "ops@g.us", name: "Ops" }],
      WhatsAppBridge: class FakeBridge {
        async start() {}
        async waitUntilReady() {}
        async stop() {}
      },
    },
  })

  try {
    const res = await fetch(`${app.url}/api/desktop/rescan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(500),
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.ok, true)
    assert.equal(body.onboardingRequired, true)
  } finally {
    await app.shutdown()
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})
