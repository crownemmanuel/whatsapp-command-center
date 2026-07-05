import assert from "node:assert/strict"
import fs from "node:fs/promises"
import test from "node:test"

test("Rust sidecar lookup uses the bundled executable basename", async () => {
  const config = JSON.parse(await fs.readFile("src-tauri/tauri.conf.json", "utf8"))
  const main = await fs.readFile("src-tauri/src/main.rs", "utf8")

  assert.deepEqual(config.bundle.externalBin, ["binaries/wacc-node"])
  assert.match(main, /\.sidecar\("wacc-node"\)/)
  assert.doesNotMatch(main, /\.sidecar\("binaries\/wacc-node"\)/)
})
