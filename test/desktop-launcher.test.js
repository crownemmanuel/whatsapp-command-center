import assert from "node:assert/strict"
import fs from "node:fs/promises"
import test from "node:test"

test("desktop launcher opens onboarding when setup is still required", async () => {
  const html = await fs.readFile(new URL("../desktop/index.html", import.meta.url), "utf8")

  assert.match(html, /\/api\/desktop\/status/)
  assert.match(html, /onboardingRequired/)
  assert.match(html, /\/onboarding/)
})
