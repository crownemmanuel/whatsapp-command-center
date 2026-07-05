import fs from "node:fs/promises"
import path from "node:path"
import { spawnSync } from "node:child_process"

const ROOT = path.resolve(import.meta.dirname, "..")
const SRC_DIR = path.join(ROOT, "src")

const files = await listJavaScriptFiles(SRC_DIR)
let failed = false

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: ROOT,
    stdio: "inherit",
  })
  if (result.status !== 0) failed = true
}

process.exit(failed ? 1 : 0)

async function listJavaScriptFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await listJavaScriptFiles(fullPath))
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(fullPath)
    }
  }
  return files.sort()
}
