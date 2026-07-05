import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { createDashboardServer } from "../src/dashboard-server.js"

test("dashboard server reports loopback readiness and serves state", async () => {
  const dashboard = createDashboardServer({
    host: "127.0.0.1",
    port: 0,
    mediaDir: "",
    getState: () => ({
      connected: false,
      watchedGroups: [],
      messages: [],
    }),
    onUpdateSettings: async () => ({}),
    onUnlockGroups: async () => ({}),
  })

  try {
    await dashboard.ready
    const address = dashboard.address()

    assert.equal(address.address, "127.0.0.1")
    assert.equal(typeof address.port, "number")
    assert.match(dashboard.url, /^http:\/\/127\.0\.0\.1:\d+$/)

    const res = await fetch(`${dashboard.url}/api/state`)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), {
      connected: false,
      watchedGroups: [],
      messages: [],
    })
  } finally {
    await dashboard.close()
  }
})

test("dashboard exposes file attachments, copy link, and backend browser open controls", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "wacc-media-"))
  await fs.writeFile(path.join(tempDir, "report.pdf"), "fake-pdf")
  const calls = []
  const dashboard = createDashboardServer({
    host: "127.0.0.1",
    port: 0,
    mediaDir: tempDir,
    getState: () => ({
      connected: true,
      watchedGroups: [{ id: "ops@g.us", name: "Ops" }],
      messages: [{
        id: "msg-1",
        chatId: "ops@g.us",
        groupName: "Ops",
        sender: "Ari",
        text: "Schedule",
        ts: 123000,
        attachment: {
          url: "/api/media/report.pdf",
          fileName: "report.pdf",
          mimeType: "application/pdf",
          size: 8,
          kind: "document",
        },
      }],
    }),
    onUpdateSettings: async () => ({}),
    onUnlockGroups: async () => ({}),
    onOpenBrowser: async () => {
      calls.push(["open"])
      return { ok: true }
    },
  })

  try {
    await dashboard.ready
    const html = await fetch(`${dashboard.url}/`).then((res) => res.text())
    assert.match(html, /copy-link/)
    assert.match(html, /api\/desktop\/open-browser/)
    assert.match(html, /msg\.attachment/)

    const media = await fetch(`${dashboard.url}/api/media/report.pdf`)
    assert.equal(media.status, 200)
    assert.equal(media.headers.get("content-type"), "application/pdf")
    assert.equal(await media.text(), "fake-pdf")

    const opened = await fetch(`${dashboard.url}/api/desktop/open-browser`, { method: "POST" })
    assert.equal(opened.status, 200)
    assert.deepEqual(await opened.json(), { ok: true })
    assert.deepEqual(calls, [["open"]])
  } finally {
    await dashboard.close()
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})
