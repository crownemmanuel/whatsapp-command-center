import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

test("config paths honor WACC_DATA_DIR", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "wacc-config-"))
  const previous = process.env.WACC_DATA_DIR
  process.env.WACC_DATA_DIR = tempDir

  try {
    const store = await import(`../src/config-store.js?case=${Date.now()}`)

    assert.equal(store.getDataDir(), tempDir)
    assert.equal(store.getConfigPath(), path.join(tempDir, "config.json"))
    assert.equal(store.getSessionDir(), path.join(tempDir, "baileys-auth"))
    assert.equal(store.getMediaDir(), path.join(tempDir, "media"))
    assert.equal(store.getQrPath(), path.join(tempDir, "wa-qr.png"))
  } finally {
    if (previous === undefined) delete process.env.WACC_DATA_DIR
    else process.env.WACC_DATA_DIR = previous
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})
