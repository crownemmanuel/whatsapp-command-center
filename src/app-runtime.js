import { exec } from "node:child_process"
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto"
import pino from "pino"
import { getMediaDir, getQrPath, getSessionDir, loadConfig, normalizeConfig, saveConfig } from "./config-store.js"
import { createDashboardServer } from "./dashboard-server.js"
import { runFirstSetup as runTerminalSetup } from "./setup.js"
import {
  WhatsAppBridge,
  listWhatsAppGroups,
  resetWhatsAppSession,
  setupWhatsAppSession,
} from "./whatsapp.js"

const LOG = pino({ name: "whatsapp-command-center", level: process.env.LOG_LEVEL || "info" })

export async function startCommandCenter(options = {}) {
  const args = options.args || []
  const previousDataDir = process.env.WACC_DATA_DIR
  if (options.dataDir) process.env.WACC_DATA_DIR = options.dataDir

  const desktop = options.desktop ?? process.env.WACC_DESKTOP === "1"
  const host = options.host || process.env.WACC_HOST || (desktop ? "127.0.0.1" : "0.0.0.0")
  const services = {
    WhatsAppBridge,
    listWhatsAppGroups,
    resetWhatsAppSession,
    runFirstSetup: runTerminalSetup,
    setupWhatsAppSession,
    ...(options.services || {}),
  }

  let dashboard = null
  let bridge = null
  let config = await loadConfig()
  const sessionDir = getSessionDir()
  const mediaDir = getMediaDir()
  const qrPath = getQrPath()
  const forceRescan = args.includes("--rescan")
  const forceSetup = args.includes("--setup") || forceRescan
  const port = Number(options.port ?? process.env.WACC_PORT ?? config.dashboardPort)
  const openDashboard = options.openDashboard ?? (!desktop && config.openDashboardOnStart)
  let setupPromise = null

  const restoreEnv = () => {
    if (!options.dataDir) return
    if (previousDataDir === undefined) delete process.env.WACC_DATA_DIR
    else process.env.WACC_DATA_DIR = previousDataDir
  }

  if (forceRescan) {
    console.log("Rescan requested: clearing WhatsApp session so you can scan the QR code again...")
    await services.resetWhatsAppSession(sessionDir)
  }

  if (!desktop && (forceSetup || !config.watchedGroups.length)) {
    if (forceSetup) {
      console.log(forceRescan ? "Scan the new QR code, then choose groups again." : "Setup mode enabled. Reconfiguring watched groups...")
    }
    config = await services.runFirstSetup({
      config,
      saveConfig,
      sessionDir,
      qrPath,
    })

    if (!config.watchedGroups.length) {
      console.log("No watched groups configured. Exiting.")
      restoreEnv()
      return { exitCode: 0, url: "", shutdown: async () => {} }
    }
  }

  const setupState = {
    onboardingRequired: desktop && (forceSetup || !config.watchedGroups.length),
    setupPhase: desktop && (forceSetup || !config.watchedGroups.length) ? "waiting_for_qr" : "ready",
    qrAvailable: false,
    error: "",
  }

  const state = {
    connected: false,
    knownGroups: mergeGroups(config.knownGroups, config.watchedGroups),
    watchedGroups: config.watchedGroups,
    keywordMode: config.keywordMode,
    keywords: config.keywords,
    pulseEnabled: config.pulseEnabled,
    pulseMode: config.pulseMode,
    pulseKeywords: config.pulseKeywords,
    flashMode: config.pulseMode,
    groupKeywords: config.groupKeywords,
    hasGroupPin: Boolean(config.groupPinHash),
    messageFontSize: config.messageFontSize,
    showImages: config.showImages,
    messages: [],
  }

  let watchedById = new Map(state.watchedGroups.map((group) => [group.id, group.name]))

  const emit = (event) => {
    if (options.onEvent) options.onEvent(event)
    if (dashboard && event.type !== "ready") dashboard.broadcast(event)
  }

  const updateSetup = (patch) => {
    Object.assign(setupState, patch)
    emit({ type: "setup-status", payload: { ...setupState } })
  }

  const applyConfigToState = (nextConfig) => {
    config = nextConfig
    state.knownGroups = mergeGroups(config.knownGroups, config.watchedGroups)
    state.keywordMode = config.keywordMode
    state.keywords = config.keywords
    state.pulseEnabled = config.pulseEnabled
    state.pulseMode = config.pulseMode
    state.pulseKeywords = config.pulseKeywords
    state.flashMode = config.pulseMode
    state.groupKeywords = config.groupKeywords
    state.hasGroupPin = Boolean(config.groupPinHash)
    state.messageFontSize = config.messageFontSize
    state.showImages = config.showImages
    state.watchedGroups = config.watchedGroups
    watchedById = new Map(config.watchedGroups.map((group) => [group.id, group.name]))
  }

  async function refreshGroups() {
    updateSetup({ setupPhase: "fetching_groups", error: "" })
    const groups = await services.listWhatsAppGroups({ sessionDir })
    const next = await saveConfig(normalizeConfig({
      ...config,
      knownGroups: mergeGroups(config.knownGroups, groups),
    }))
    applyConfigToState(next)
    updateSetup({ setupPhase: "groups_ready", onboardingRequired: true, error: "" })
    emit({ type: "groups-updated", payload: { knownGroups: state.knownGroups, watchedGroups: state.watchedGroups } })
    return { knownGroups: state.knownGroups, watchedGroups: state.watchedGroups }
  }

  async function beginWebSetup({ resetSession = false } = {}) {
    if (setupPromise) return setupPromise
    setupPromise = (async () => {
      try {
        if (resetSession) await services.resetWhatsAppSession(sessionDir)
        updateSetup({ onboardingRequired: true, setupPhase: "waiting_for_qr", error: "" })
        await services.setupWhatsAppSession({
          sessionDir,
          qrFilePath: qrPath,
          printQr: false,
          onQr: async () => {
            updateSetup({ onboardingRequired: true, setupPhase: "waiting_for_scan", qrAvailable: true, error: "" })
            emit({ type: "qr-updated", payload: { url: "/api/setup/qr.png" } })
          },
        })
        updateSetup({ setupPhase: "connected", error: "" })
        return await refreshGroups()
      } catch (error) {
        updateSetup({ setupPhase: "error", error: errorMessage(error) })
        throw error
      } finally {
        setupPromise = null
      }
    })()
    setupPromise.catch(() => {})
    return setupPromise
  }

  async function stopBridge() {
    if (!bridge) return
    await bridge.stop()
    bridge = null
  }

  async function startBridgeIfNeeded({ waitUntilReady = false } = {}) {
    if (bridge || !state.watchedGroups.length) return
    bridge = new services.WhatsAppBridge({
      sessionDir,
      mediaDir,
      onConnectionChange: (connected) => {
        state.connected = connected
        if (dashboard) dashboard.broadcast({ type: "state", payload: { ...state } })
      },
      onMessage: (incoming) => {
        if (!watchedById.has(incoming.chatId)) return

        const message = {
          ...incoming,
          groupName: watchedById.get(incoming.chatId),
        }

        state.knownGroups = mergeGroups(state.knownGroups, [{ id: incoming.chatId, name: message.groupName }])

        if (!messageMatchesFilter(message, state)) {
          return
        }

        state.messages = [...state.messages, message].slice(-500)
        dashboard.broadcast({
          type: "new-message",
          payload: {
            message,
            flash: shouldFlashMessage(message, state),
          },
        })
      },
    })
    await bridge.start()
    if (waitUntilReady) await bridge.waitUntilReady()
    else bridge.waitUntilReady().catch((error) => {
      LOG.warn({ err: error }, "WhatsApp bridge did not become ready")
    })
  }

  dashboard = createDashboardServer({
    port,
    host,
    mediaDir,
    qrPath,
    getState: () => ({ ...state }),
    getDesktopStatus: () => ({
      ...setupState,
      dashboardUrl: dashboard?.url || "",
    }),
    onRefreshGroups: async () => refreshGroups(),
    onCompleteOnboarding: async (incoming) => {
      const watchedGroups = Array.isArray(incoming.watchedGroups) ? incoming.watchedGroups : []
      const next = await saveConfig(normalizeConfig({
        ...config,
        knownGroups: mergeGroups(config.knownGroups, watchedGroups),
        watchedGroups,
      }))
      applyConfigToState(next)
      updateSetup({ onboardingRequired: false, setupPhase: "ready", error: "" })
      if (state.watchedGroups.length) await startBridgeIfNeeded({ waitUntilReady: false })
      dashboard.broadcast({ type: "state", payload: { ...state } })
      return { ...state }
    },
    onRescan: async () => {
      await stopBridge()
      const next = await saveConfig(normalizeConfig({ ...config, watchedGroups: [] }))
      applyConfigToState(next)
      void beginWebSetup({ resetSession: true })
      return { ok: true, ...setupState }
    },
    onLogout: async () => {
      await stopBridge()
      await services.resetWhatsAppSession(sessionDir)
      const next = await saveConfig(normalizeConfig({ ...config, watchedGroups: [] }))
      applyConfigToState(next)
      updateSetup({ onboardingRequired: true, setupPhase: "logged_out", qrAvailable: false, error: "" })
      return { ok: true, ...setupState }
    },
    onUnlockGroups: async (incoming) => {
      const pin = typeof incoming?.pin === "string" ? incoming.pin.trim() : ""
      if (config.groupPinHash && !verifyPin(pin, config.groupPinHash)) {
        const error = new Error("Invalid PIN")
        error.statusCode = 403
        throw error
      }

      return {
        knownGroups: mergeGroups(config.knownGroups, config.watchedGroups),
        watchedGroups: config.watchedGroups,
        groupKeywords: config.groupKeywords,
      }
    },
    onUpdateSettings: async (incoming) => {
      const pinNewRaw = typeof incoming.groupPinNew === "string" ? incoming.groupPinNew.trim() : ""
      const wantsPinChange = pinNewRaw.length > 0
      const pinCurrent = typeof incoming.groupPinCurrent === "string" ? incoming.groupPinCurrent.trim() : ""
      const pinAuth = typeof incoming.groupPinAuth === "string" ? incoming.groupPinAuth.trim() : ""
      const isGroupsUpdate = Array.isArray(incoming.watchedGroups) || isObject(incoming.groupKeywords)

      if (config.groupPinHash && wantsPinChange && !verifyPin(pinCurrent, config.groupPinHash)) {
        throw badRequest("Current PIN is incorrect")
      }
      if (wantsPinChange && pinNewRaw && !/^\d{4,8}$/.test(pinNewRaw)) {
        throw badRequest("PIN must be 4-8 digits")
      }
      if (config.groupPinHash && isGroupsUpdate && !verifyPin(pinAuth, config.groupPinHash)) {
        throw forbidden("PIN required to update groups")
      }

      const next = normalizeConfig({
        ...config,
        knownGroups: mergeGroups(config.knownGroups, incoming.knownGroups, incoming.watchedGroups),
        keywordMode: incoming.keywordMode,
        keywords: incoming.keywords,
        pulseEnabled: incoming.pulseEnabled,
        pulseMode: incoming.pulseMode,
        pulseKeywords: incoming.pulseKeywords,
        flashMode: incoming.pulseMode === "keywords" ? "keywords" : "all",
        groupKeywords: incoming.groupKeywords,
        messageFontSize: incoming.messageFontSize,
        showImages: incoming.showImages,
        groupPinHash: wantsPinChange
          ? (pinNewRaw ? hashPin(pinNewRaw) : "")
          : config.groupPinHash,
        watchedGroups: Array.isArray(incoming.watchedGroups)
          ? incoming.watchedGroups
          : config.watchedGroups,
      })

      applyConfigToState(await saveConfig(next))
      if (state.keywordMode === "keywords") {
        state.messages = state.messages.filter((message) =>
          messageMatchesFilter(message, state)
        )
      }
      if (state.watchedGroups.length) await startBridgeIfNeeded({ waitUntilReady: false })
      return { ...state }
    },
  })

  await dashboard.ready
  emit({ type: "ready", url: dashboard.url })

  if (openDashboard) {
    openInBrowser(dashboard.url)
  }

  if (desktop && setupState.onboardingRequired) {
    void beginWebSetup()
  } else {
    await startBridgeIfNeeded({ waitUntilReady: !desktop })
  }

  if (!desktop) {
    console.log("WhatsApp Command Center is running.")
    console.log(`Dashboard: ${dashboard.url}`)
  }

  const shutdown = async (signal = "manual") => {
    LOG.info({ signal }, "Shutting down")
    await stopBridge()
    if (dashboard) await dashboard.close()
    restoreEnv()
  }

  if (options.installSignalHandlers) {
    process.on("SIGINT", () => {
      void shutdown("SIGINT").finally(() => process.exit(0))
    })
    process.on("SIGTERM", () => {
      void shutdown("SIGTERM").finally(() => process.exit(0))
    })
  }

  return {
    url: dashboard.url,
    dashboard,
    state,
    shutdown,
  }
}

function openInBrowser(url) {
  if (process.env.WACC_OPEN_DASHBOARD === "0") return

  const cmd = process.platform === "darwin"
    ? `open "${url}"`
    : process.platform === "win32"
      ? `start "" "${url}"`
      : `xdg-open "${url}"`

  exec(cmd, (error) => {
    if (error) {
      LOG.warn({ err: error }, "Could not auto-open dashboard")
    }
  })
}

function messageMatchesFilter(message, keywordMode, keywords) {
  if (keywordMode?.keywordMode) {
    const enabled = keywordMode.keywordMode === "keywords"
    const list = getKeywordsForMessage(message, keywordMode)
    return matchesKeywords(message, list, enabled)
  }
  return matchesKeywords(message, keywords, keywordMode === "keywords")
}

function shouldFlashMessage(message, state) {
  if (!state.pulseEnabled) return false
  if (state.pulseMode !== "keywords") return true
  const list = Array.isArray(state.pulseKeywords) ? state.pulseKeywords : []
  if (list.length === 0) return false
  return matchesKeywords(message, list, true)
}

function getKeywordsForMessage(message, state) {
  const groupId = String(message?.chatId || "")
  const groupSpecific = state?.groupKeywords?.[groupId]
  if (Array.isArray(groupSpecific) && groupSpecific.length > 0) return groupSpecific
  return Array.isArray(state?.keywords) ? state.keywords : []
}

function matchesKeywords(message, keywords, enabled) {
  if (!enabled) return true
  const list = Array.isArray(keywords) ? keywords : []
  if (list.length === 0) return true
  const text = String(message?.text || "").toLowerCase()
  return list.some((keyword) => text.includes(String(keyword).toLowerCase()))
}

function mergeGroups(...lists) {
  const byId = new Map()
  for (const list of lists) {
    if (!Array.isArray(list)) continue
    for (const group of list) {
      if (!group || typeof group !== "object") continue
      const id = String(group.id || "").trim()
      if (!id) continue
      const name = String(group.name || "").trim()
      const current = byId.get(id)
      if (!current) {
        byId.set(id, { id, name: name || id })
      } else if (name && (current.name === current.id || !current.name)) {
        byId.set(id, { id, name })
      }
    }
  }
  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name))
}

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function hashPin(pin) {
  const salt = randomBytes(16).toString("hex")
  const hash = scryptSync(pin, salt, 32).toString("hex")
  return `${salt}:${hash}`
}

function verifyPin(pin, storedHash) {
  if (!pin || !storedHash || !storedHash.includes(":")) return false
  const [salt, expectedHex] = storedHash.split(":")
  if (!salt || !expectedHex) return false
  const actualHex = scryptSync(pin, salt, 32).toString("hex")
  const expected = Buffer.from(expectedHex, "hex")
  const actual = Buffer.from(actualHex, "hex")
  if (expected.length !== actual.length) return false
  return timingSafeEqual(expected, actual)
}

function badRequest(message) {
  const error = new Error(message)
  error.statusCode = 400
  return error
}

function forbidden(message) {
  const error = new Error(message)
  error.statusCode = 403
  return error
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}
