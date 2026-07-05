import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { createDashboardServer } from "../src/dashboard-server.js"

test("desktop onboarding routes expose status and actions", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "wacc-onboarding-"))
  const qrPath = path.join(tempDir, "wa-qr.png")
  await fs.writeFile(qrPath, Buffer.from("fake-png"))

  const calls = []
  const dashboard = createDashboardServer({
    host: "127.0.0.1",
    port: 0,
    mediaDir: "",
    qrPath,
    getState: () => ({
      connected: false,
      knownGroups: [{ id: "one@g.us", name: "One" }],
      watchedGroups: [],
      hasGroupPin: true,
      messages: [],
    }),
    getDesktopStatus: () => ({
      onboardingRequired: true,
      setupPhase: "waiting_for_qr",
      dashboardUrl: "",
    }),
    onUpdateSettings: async () => ({}),
    onUnlockGroups: async () => ({}),
    onRefreshGroups: async (incoming) => {
      calls.push(["refresh", incoming])
      return { knownGroups: [{ id: "two@g.us", name: "Two" }] }
    },
    onCompleteOnboarding: async (incoming) => {
      calls.push(["complete", incoming])
      return { watchedGroups: incoming.watchedGroups }
    },
    onRescan: async () => {
      calls.push(["rescan"])
      return { ok: true, setupPhase: "waiting_for_qr" }
    },
    onLogout: async () => {
      calls.push(["logout"])
      return { ok: true, onboardingRequired: true }
    },
    onForgotPin: async () => {
      calls.push(["forgot-pin"])
      return { ok: true, onboardingRequired: true }
    },
  })

  try {
    await dashboard.ready

    const status = await fetchJson(`${dashboard.url}/api/desktop/status`)
    assert.equal(status.onboardingRequired, true)
    assert.equal(status.setupPhase, "waiting_for_qr")

    const onboarding = await fetch(`${dashboard.url}/onboarding`)
    assert.equal(onboarding.status, 200)
    const onboardingHtml = await onboarding.text()
    assert.match(onboardingHtml, /Connect WhatsApp \/ Groups/)
    assert.match(onboardingHtml, /Group PIN required/)
    assert.match(onboardingHtml, /Forgot PIN/)
    assert.match(onboardingHtml, /copy-link/)
    assert.match(onboardingHtml, /id="pin-gate" class="pin-gate"/)
    assert.match(onboardingHtml, /id="protected-flow" class="hidden"/)
    assert.match(onboardingHtml, /id="groups-section" class="panel hidden"/)

    const rootHtml = await fetch(`${dashboard.url}/`).then((res) => res.text())
    assert.match(rootHtml, /Connect WhatsApp \/ Groups/)

    const dashboardHtml = await fetch(`${dashboard.url}/?display=1`).then((res) => res.text())
    assert.match(dashboardHtml, /Connect WhatsApp/)
    assert.match(dashboardHtml, /href="\/onboarding"/)

    const settingsHtml = await fetch(`${dashboard.url}/settings`).then((res) => res.text())
    assert.match(settingsHtml, /Refresh groups/)
    assert.match(settingsHtml, /Forgot PIN/)
    assert.match(settingsHtml, /api\/groups\/forgot-pin/)
    assert.match(settingsHtml, /Webhooks/)
    assert.match(settingsHtml, /add-webhook/)
    assert.match(settingsHtml, /webhook-trigger/)
    assert.match(settingsHtml, /settings-section/)
    assert.match(settingsHtml, /toggleWebhookFields/)
    assert.match(settingsHtml, /data-field-for="sender"/)
    assert.match(settingsHtml, /data-field-for="keyword"/)
    assert.match(settingsHtml, /data-field-for="body"/)
    assert.match(settingsHtml, /aria-label="Add webhook"/)

    const qr = await fetch(`${dashboard.url}/api/setup/qr.png`)
    assert.equal(qr.status, 200)
    assert.equal(await qr.text(), "fake-png")

    const refreshed = await postJson(`${dashboard.url}/api/groups/refresh`, { pin: "1234" })
    assert.deepEqual(refreshed.knownGroups, [{ id: "two@g.us", name: "Two" }])

    const completed = await postJson(`${dashboard.url}/api/onboarding/groups`, {
      groupPinAuth: "1234",
      watchedGroups: [{ id: "two@g.us", name: "Two" }],
    })
    assert.deepEqual(completed.watchedGroups, [{ id: "two@g.us", name: "Two" }])

    const rescan = await postJson(`${dashboard.url}/api/desktop/rescan`, {})
    assert.deepEqual(rescan, { ok: true, setupPhase: "waiting_for_qr" })

    const logout = await postJson(`${dashboard.url}/api/desktop/logout`, {})
    assert.deepEqual(logout, { ok: true, onboardingRequired: true })

    const forgotPin = await postJson(`${dashboard.url}/api/groups/forgot-pin`, {})
    assert.deepEqual(forgotPin, { ok: true, onboardingRequired: true })

    assert.deepEqual(calls, [
      ["refresh", { pin: "1234" }],
      ["complete", { groupPinAuth: "1234", watchedGroups: [{ id: "two@g.us", name: "Two" }] }],
      ["rescan"],
      ["logout"],
      ["forgot-pin"],
    ])
  } finally {
    await dashboard.close()
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

async function fetchJson(url) {
  const res = await fetch(url)
  assert.equal(res.status, 200)
  return res.json()
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  assert.equal(res.status, 200)
  return res.json()
}
