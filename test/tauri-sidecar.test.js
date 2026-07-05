import assert from "node:assert/strict"
import fs from "node:fs/promises"
import test from "node:test"

test("Rust sidecar lookup uses the bundled executable basename", async () => {
  const config = JSON.parse(await fs.readFile("src-tauri/tauri.conf.json", "utf8"))
  const main = await fs.readFile("src-tauri/src/main.rs", "utf8")

  assert.deepEqual(config.bundle.externalBin, ["binaries/wacc-node"])
  assert.deepEqual(config.bundle.icon, [
    "icons/32x32.png",
    "icons/128x128.png",
    "icons/128x128@2x.png",
    "icons/icon.icns",
    "icons/icon.ico",
    "icons/icon.png",
  ])
  assert.match(main, /\.sidecar\("wacc-node"\)/)
  assert.doesNotMatch(main, /\.sidecar\("binaries\/wacc-node"\)/)
})
