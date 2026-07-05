import { createWriteStream } from "node:fs"
import fs from "node:fs/promises"
import https from "node:https"
import os from "node:os"
import path from "node:path"
import { execFileSync, spawnSync } from "node:child_process"

const ROOT = path.resolve(import.meta.dirname, "..")
const TAURI_DIR = path.join(ROOT, "src-tauri")
const BIN_DIR = path.join(TAURI_DIR, "binaries")
const RESOURCE_BACKEND = path.join(TAURI_DIR, "resources", "backend")
const CACHE_DIR = path.join(ROOT, ".cache", "node-runtime")
const NODE_VERSION = process.env.NODE_RUNTIME_VERSION || "22.17.0"

await fs.mkdir(BIN_DIR, { recursive: true })
await fs.mkdir(CACHE_DIR, { recursive: true })
await prepareBackendResources()
await prepareNodeSidecar()

async function prepareBackendResources() {
  await fs.rm(RESOURCE_BACKEND, { recursive: true, force: true })
  await fs.mkdir(RESOURCE_BACKEND, { recursive: true })
  await fs.cp(path.join(ROOT, "src"), path.join(RESOURCE_BACKEND, "src"), { recursive: true })
  await fs.copyFile(path.join(ROOT, "package.json"), path.join(RESOURCE_BACKEND, "package.json"))
  await fs.copyFile(path.join(ROOT, "package-lock.json"), path.join(RESOURCE_BACKEND, "package-lock.json"))

  const result = spawnSync("npm", ["ci", "--omit=dev", "--ignore-scripts"], {
    cwd: RESOURCE_BACKEND,
    stdio: "inherit",
    shell: process.platform === "win32",
  })
  if (result.status !== 0) {
    throw new Error("Failed to install production backend dependencies for Tauri resources")
  }
}

async function prepareNodeSidecar() {
  const targetTriple = process.env.TAURI_TARGET_TRIPLE || getHostTriple()
  const extension = targetTriple.includes("windows") ? ".exe" : ""
  const destination = path.join(BIN_DIR, `wacc-node-${targetTriple}${extension}`)
  const runtime = await resolveNodeRuntime(targetTriple)
  await fs.copyFile(runtime, destination)
  if (!extension) await fs.chmod(destination, 0o755)
  console.log(`Prepared Tauri sidecar: ${path.relative(ROOT, destination)}`)
}

async function resolveNodeRuntime(targetTriple) {
  if (process.env.WACC_USE_LOCAL_NODE === "1") return process.execPath

  try {
    return await downloadOfficialNode(targetTriple)
  } catch (error) {
    console.warn(`Could not download official Node.js runtime: ${error.message}`)
    console.warn(`Falling back to local Node.js runtime at ${process.execPath}`)
    return process.execPath
  }
}

async function downloadOfficialNode(targetTriple) {
  const platform = nodePlatform(targetTriple)
  const arch = nodeArch(targetTriple)
  const extension = platform === "win" ? "zip" : "tar.gz"
  const basename = `node-v${NODE_VERSION}-${platform}-${arch}`
  const archiveName = `${basename}.${extension}`
  const archivePath = path.join(CACHE_DIR, archiveName)
  const extractedDir = path.join(CACHE_DIR, basename)
  const nodePath = platform === "win"
    ? path.join(extractedDir, "node.exe")
    : path.join(extractedDir, "bin", "node")

  try {
    await fs.access(nodePath)
    return nodePath
  } catch {
    // Download and extract below.
  }

  const url = `https://nodejs.org/dist/v${NODE_VERSION}/${archiveName}`
  await download(url, archivePath)
  await fs.rm(extractedDir, { recursive: true, force: true })
  const result = spawnSync("tar", ["-xf", archivePath, "-C", CACHE_DIR], { stdio: "inherit" })
  if (result.status !== 0) {
    throw new Error(`Failed to extract ${archiveName}`)
  }
  await fs.access(nodePath)
  return nodePath
}

function getHostTriple() {
  const host = execFileSync("rustc", ["-vV"], { encoding: "utf8" })
    .split("\n")
    .find((line) => line.startsWith("host: "))
    ?.slice("host: ".length)
    .trim()
  if (!host) throw new Error("Could not determine Rust host target triple")
  return host
}

function nodePlatform(targetTriple) {
  if (targetTriple.includes("apple-darwin")) return "darwin"
  if (targetTriple.includes("windows")) return "win"
  if (targetTriple.includes("linux")) return "linux"
  return os.platform()
}

function nodeArch(targetTriple) {
  if (targetTriple.startsWith("aarch64") || targetTriple.includes("arm64")) return "arm64"
  if (targetTriple.startsWith("x86_64") || targetTriple.includes("x64")) return "x64"
  if (targetTriple.startsWith("armv7")) return "armv7l"
  return os.arch()
}

function download(url, destination) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode || 0) && response.headers.location) {
        response.resume()
        download(response.headers.location, destination).then(resolve, reject)
        return
      }
      if (response.statusCode !== 200) {
        response.resume()
        reject(new Error(`HTTP ${response.statusCode} for ${url}`))
        return
      }
      const file = createWriteStream(destination)
      response.pipe(file)
      file.on("finish", () => file.close(resolve))
      file.on("error", reject)
    })
    request.on("error", reject)
  })
}
