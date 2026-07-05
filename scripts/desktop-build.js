import path from "node:path"
import { spawnSync } from "node:child_process"

const ROOT = path.resolve(import.meta.dirname, "..")
const tauriBin = path.join(
  ROOT,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tauri.cmd" : "tauri"
)

const bundles = process.env.WACC_TAURI_BUNDLES || defaultBundles()
const result = spawnSync(tauriBin, ["build", "--bundles", bundles], {
  cwd: ROOT,
  stdio: "inherit",
  shell: process.platform === "win32",
})

process.exit(result.status ?? 1)

function defaultBundles() {
  if (process.platform === "darwin") return "app"
  if (process.platform === "win32") return "nsis"
  return "appimage"
}
