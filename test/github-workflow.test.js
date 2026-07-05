import assert from "node:assert/strict"
import fs from "node:fs/promises"
import test from "node:test"

test("desktop build workflow covers Windows, unsigned macOS, and Linux", async () => {
  const workflow = await fs.readFile(".github/workflows/desktop-build.yml", "utf8")

  assert.match(workflow, /windows-latest/)
  assert.match(workflow, /macos-latest/)
  assert.match(workflow, /ubuntu-22\.04/)
  assert.match(workflow, /tags:\s*\n\s*-\s*"v\*"/)
  assert.doesNotMatch(workflow, /branches:\s*\n\s*-\s*main/)
  assert.match(workflow, /APPLE_SIGNING_IDENTITY:\s+"\-"/)
  assert.match(workflow, /TAURI_TARGET_TRIPLE/)
  assert.match(workflow, /tauri-apps\/tauri-action@v1/)
  assert.match(workflow, /libwebkit2gtk-4\.1-dev/)
})
