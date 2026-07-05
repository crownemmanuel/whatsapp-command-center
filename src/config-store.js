import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, "..")
const DEFAULT_DATA_DIR = path.join(ROOT, "data")

export function defaultConfig() {
  return {
    dashboardPort: 3399,
    openDashboardOnStart: true,
    showImages: true,
    knownGroups: [],
    watchedGroups: [],
    keywordMode: "all",
    keywords: [],
    pulseEnabled: false,
    pulseMode: "all",
    pulseKeywords: [],
    flashMode: "keywords",
    groupKeywords: {},
    groupPinHash: "",
    webhooks: [],
    messageFontSize: 42,
  }
}

export async function loadConfig() {
  const dataDir = getDataDir()
  const configPath = getConfigPath()
  await fs.mkdir(dataDir, { recursive: true })
  try {
    const raw = await fs.readFile(configPath, "utf8")
    return normalizeConfig(JSON.parse(raw))
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      const config = defaultConfig()
      await saveConfig(config)
      return config
    }
    throw error
  }
}

export async function saveConfig(config) {
  await fs.mkdir(getDataDir(), { recursive: true })
  const normalized = normalizeConfig(config)
  await fs.writeFile(getConfigPath(), `${JSON.stringify(normalized, null, 2)}\n`, "utf8")
  return normalized
}

export function getDataDir() {
  const configured = process.env.WACC_DATA_DIR
  return configured ? path.resolve(configured) : DEFAULT_DATA_DIR
}

export function getConfigPath() {
  return path.join(getDataDir(), "config.json")
}

export function getSessionDir() {
  if (process.env.WACC_DATA_DIR) return path.join(getDataDir(), "baileys-auth")
  return path.join(ROOT, "baileys-auth")
}

export function getMediaDir() {
  return path.join(getDataDir(), "media")
}

export function getQrPath() {
  if (process.env.WACC_DATA_DIR) return path.join(getDataDir(), "wa-qr.png")
  return path.join(ROOT, "wa-qr.png")
}

export function normalizeConfig(input) {
  const defaults = defaultConfig()
  const safe = input && typeof input === "object" ? input : {}

  const knownGroups = Array.isArray(safe.knownGroups)
    ? safe.knownGroups
        .filter((item) => item && typeof item === "object")
        .map((item) => ({
          id: String(item.id || "").trim(),
          name: String(item.name || "").trim(),
        }))
        .filter((item) => item.id)
    : []

  const watchedGroups = Array.isArray(safe.watchedGroups)
    ? safe.watchedGroups
        .filter((item) => item && typeof item === "object")
        .map((item) => ({
          id: String(item.id || "").trim(),
          name: String(item.name || "").trim(),
        }))
        .filter((item) => item.id)
    : []

  const keywords = Array.isArray(safe.keywords)
    ? safe.keywords.map((item) => String(item || "").trim()).filter(Boolean)
    : []
  const pulseKeywords = Array.isArray(safe.pulseKeywords)
    ? safe.pulseKeywords.map((item) => String(item || "").trim()).filter(Boolean)
    : []

  const groupKeywords = normalizeGroupKeywords(safe.groupKeywords)
  const webhooks = normalizeWebhooks(safe.webhooks)

  const dashboardPort = toPositiveInt(safe.dashboardPort, defaults.dashboardPort)
  const messageFontSize = toPositiveInt(safe.messageFontSize, defaults.messageFontSize)
  const keywordMode = safe.keywordMode === "keywords" ? "keywords" : "all"
  const pulseMode = typeof safe.pulseMode === "string"
    ? (safe.pulseMode === "keywords" ? "keywords" : "all")
    : (safe.flashMode === "keywords" ? "keywords" : "all")
  const flashMode = safe.flashMode === "keywords" ? "keywords" : "all"
  const groupPinHash = typeof safe.groupPinHash === "string" ? safe.groupPinHash.trim() : ""

  return {
    dashboardPort,
    openDashboardOnStart: safe.openDashboardOnStart !== false,
    showImages: safe.showImages !== false,
    knownGroups,
    watchedGroups,
    keywordMode,
    keywords,
    pulseEnabled: Boolean(safe.pulseEnabled),
    pulseMode: pulseMode || flashMode || "all",
    pulseKeywords,
    flashMode,
    groupKeywords,
    groupPinHash,
    webhooks,
    messageFontSize: Math.max(16, Math.min(120, messageFontSize)),
  }
}

function toPositiveInt(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.trunc(n)
}

function normalizeGroupKeywords(input) {
  if (!input || typeof input !== "object") return {}
  const out = {}
  for (const [groupId, words] of Object.entries(input)) {
    const id = String(groupId || "").trim()
    if (!id) continue
    const normalized = Array.isArray(words)
      ? words.map((word) => String(word || "").trim()).filter(Boolean)
      : []
    out[id] = normalized
  }
  return out
}

function normalizeWebhooks(input) {
  if (!Array.isArray(input)) return []
  return input
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const triggerType = ["sender", "keyword"].includes(item.triggerType) ? item.triggerType : "all"
      const method = normalizeWebhookMethod(item.method)
      const url = String(item.url || "").trim()
      const name = String(item.name || "").trim()
      const id = String(item.id || name || url || triggerType).trim()
      return {
        id,
        name,
        enabled: item.enabled !== false,
        triggerType,
        sender: String(item.sender || "").trim(),
        keyword: String(item.keyword || "").trim(),
        keywordIsRegex: Boolean(item.keywordIsRegex),
        method,
        url,
        headers: normalizeWebhookHeaders(item.headers),
        bodyTemplate: String(item.bodyTemplate || ""),
        sendEntireMessage: Boolean(item.sendEntireMessage),
        regex: String(item.regex || "").trim(),
      }
    })
    .filter((item) => item.id && item.url)
}

function normalizeWebhookMethod(value) {
  const method = String(value || "POST").trim().toUpperCase()
  return ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method) ? method : "POST"
}

function normalizeWebhookHeaders(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {}
  const out = {}
  for (const [key, value] of Object.entries(input)) {
    const name = String(key || "").trim()
    if (!name) continue
    out[name] = String(value || "")
  }
  return out
}
