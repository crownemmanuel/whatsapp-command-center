import assert from "node:assert/strict"
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
