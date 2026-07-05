import assert from "node:assert/strict"
import fs from "node:fs/promises"
import test from "node:test"

test("package scripts expose the Tauri desktop entrypoints", async () => {
  const packageJson = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url), "utf8"))

  assert.equal(packageJson.scripts["desktop:dev"], "tauri dev")
  assert.equal(packageJson.scripts.tauri, "tauri")
})
