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

test("desktop status requires onboarding while WhatsApp is disconnected", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "wacc-runtime-disconnected-"))
  await fs.mkdir(tempDir, { recursive: true })
  await fs.writeFile(path.join(tempDir, "config.json"), JSON.stringify({
    dashboardPort: 3399,
    watchedGroups: [{ id: "ops@g.us", name: "Ops" }],
    knownGroups: [{ id: "ops@g.us", name: "Ops" }],
  }))

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
      setupWhatsAppSession: async () => new Promise(() => {}),
      listWhatsAppGroups: async () => [{ id: "ops@g.us", name: "Ops" }],
      WhatsAppBridge: class FakeBridge {
        async start() {}
        async waitUntilReady() {}
        async stop() {}
      },
    },
  })

  try {
    const status = await fetch(`${app.url}/api/desktop/status`).then((res) => res.json())
    assert.equal(status.state.connected, false)
    assert.equal(status.onboardingRequired, true)
  } finally {
    await app.shutdown()
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("forgot PIN route logs out WhatsApp and clears the group PIN", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "wacc-runtime-forgot-pin-"))
  await fs.mkdir(tempDir, { recursive: true })
  await fs.writeFile(path.join(tempDir, "config.json"), JSON.stringify({
    dashboardPort: 3399,
    watchedGroups: [{ id: "ops@g.us", name: "Ops" }],
    knownGroups: [{ id: "ops@g.us", name: "Ops" }],
    groupPinHash: "set",
  }))

  const calls = []
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
      resetWhatsAppSession: async () => {
        calls.push(["reset"])
      },
      setupWhatsAppSession: async () => new Promise(() => {}),
      listWhatsAppGroups: async () => [{ id: "ops@g.us", name: "Ops" }],
      WhatsAppBridge: class FakeBridge {
        async start() {}
        async waitUntilReady() {}
        async stop() {
          calls.push(["stop"])
        }
      },
    },
  })

  try {
    const res = await fetch(`${app.url}/api/groups/forgot-pin`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.ok, true)
    assert.equal(body.onboardingRequired, true)
    assert.equal(app.state.hasGroupPin, false)
    assert.equal(app.state.watchedGroups.length, 0)
    assert.deepEqual(calls, [["stop"], ["reset"]])
  } finally {
    await app.shutdown()
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("webhooks fire for matching messages with templates and regex captures", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "wacc-runtime-webhooks-"))
  await fs.mkdir(tempDir, { recursive: true })
  await fs.writeFile(path.join(tempDir, "config.json"), JSON.stringify({
    dashboardPort: 3399,
    watchedGroups: [{ id: "ops@g.us", name: "Ops" }],
    knownGroups: [{ id: "ops@g.us", name: "Ops" }],
    webhooks: [
      {
        id: "all",
        enabled: true,
        triggerType: "all",
        method: "POST",
        url: "https://example.test/all",
        sendEntireMessage: true,
      },
      {
        id: "sender",
        enabled: true,
        triggerType: "sender",
        sender: "Ari",
        method: "PUT",
        url: "https://example.test/orders/{{orderId}}",
        headers: { "x-group": "{{groupName}}" },
        bodyTemplate: "{\"order\":\"{{orderId}}\",\"from\":\"{{sender}}\"}",
        regex: "order\\s+(?<orderId>\\d+)",
      },
      {
        id: "keyword",
        enabled: true,
        triggerType: "keyword",
        keyword: "urgent",
        method: "GET",
        url: "https://example.test/search?q={{match1}}",
        regex: "urgent\\s+(\\w+)",
      },
      {
        id: "miss",
        enabled: true,
        triggerType: "sender",
        sender: "Bea",
        method: "POST",
        url: "https://example.test/miss",
      },
    ],
  }))

  let bridgeOptions
  const requests = []
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
      setupWhatsAppSession: async () => new Promise(() => {}),
      listWhatsAppGroups: async () => [{ id: "ops@g.us", name: "Ops" }],
      fetch: async (url, options) => {
        requests.push({ url, options })
        return { ok: true, status: 204, text: async () => "" }
      },
      WhatsAppBridge: class FakeBridge {
        constructor(options) {
          bridgeOptions = options
        }
        async start() {}
        async waitUntilReady() {}
        async stop() {}
      },
    },
  })

  try {
    bridgeOptions.onMessage({
      id: "m1",
      chatId: "ops@g.us",
      sender: "Ari",
      text: "urgent order 4721",
      ts: 123000,
    })

    await waitFor(() => requests.length === 3)

    assert.deepEqual(requests.map((request) => [request.options.method, request.url]), [
      ["POST", "https://example.test/all"],
      ["PUT", "https://example.test/orders/4721"],
      ["GET", "https://example.test/search?q=order"],
    ])
    assert.equal(requests[0].options.headers["content-type"], "application/json")
    assert.equal(JSON.parse(requests[0].options.body).text, "urgent order 4721")
    assert.equal(requests[1].options.headers["x-group"], "Ops")
    assert.equal(requests[1].options.body, "{\"order\":\"4721\",\"from\":\"Ari\"}")
    assert.equal("body" in requests[2].options, false)
  } finally {
    await app.shutdown()
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

async function waitFor(predicate) {
  const started = Date.now()
  while (Date.now() - started < 1000) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.equal(predicate(), true)
}
