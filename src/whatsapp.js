import fs from "node:fs/promises"
import path from "node:path"
import pino from "pino"
import QRCode from "qrcode"
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys"
import { downloadMediaMessage } from "@whiskeysockets/baileys"

const LOG = pino({ name: "whatsapp-command-center", level: process.env.LOG_LEVEL || "info" })

export class WhatsAppBridge {
  constructor({ sessionDir, mediaDir, onMessage, onConnectionChange }) {
    this.sessionDir = sessionDir
    this.mediaDir = mediaDir
    this.onMessage = onMessage
    this.onConnectionChange = onConnectionChange
    this.sock = null
    this.connecting = null
    this.isReady = false
    this.readyWaiters = []
    this.shouldReconnect = true
  }

  async start() {
    if (!this.connecting) {
      this.connecting = this.connect()
    }
    await this.connecting
  }

  async waitUntilReady() {
    if (this.isReady) return
    await new Promise((resolve, reject) => {
      this.readyWaiters.push({ resolve, reject })
    })
  }

  async stop() {
    this.shouldReconnect = false
    this.isReady = false
    this.resolveWaiters(new Error("WhatsApp bridge stopped"))
    if (this.onConnectionChange) this.onConnectionChange(false)
    if (this.sock) {
      try {
        this.sock.end(undefined)
      } catch {
        // ignore close errors
      }
      this.sock = null
    }
  }

  async connect() {
    const { state, saveCreds } = await useMultiFileAuthState(this.sessionDir)
    const { version } = await fetchLatestBaileysVersion()

    const sock = makeWASocket({
      auth: state,
      version,
      logger: LOG.child({ module: "baileys", level: "warn" }),
      markOnlineOnConnect: false,
    })

    this.sock = sock
    sock.ev.on("creds.update", saveCreds)

    sock.ev.on("messages.upsert", (payload) => {
      if (!this.onMessage) return
      const messages = Array.isArray(payload?.messages) ? payload.messages : []
      for (const msg of messages) {
        void this.processIncomingMessage(msg)
      }
    })

    sock.ev.on("connection.update", (update) => {
      if (update.connection === "open") {
        this.isReady = true
        this.resolveWaiters()
        if (this.onConnectionChange) this.onConnectionChange(true)
        LOG.info("WhatsApp connected")
        return
      }

      if (update.connection !== "close") return

      const statusCode = update?.lastDisconnect?.error?.output?.statusCode
      const loggedOut = statusCode === DisconnectReason.loggedOut
      this.isReady = false
      this.resolveWaiters(new Error("WhatsApp connection closed"))
      if (this.onConnectionChange) this.onConnectionChange(false)
      LOG.warn({ statusCode, loggedOut }, "WhatsApp connection closed")

      if (!this.shouldReconnect || loggedOut) {
        return
      }

      setTimeout(() => {
        this.connecting = this.connect()
      }, 2500)
    })
  }

  async processIncomingMessage(msg) {
    const rows = toIncomingRows({ messages: [msg] })
    for (const row of rows) {
      if (row.hasImage && this.mediaDir) {
        try {
          const buf = await downloadMediaMessage(msg, "buffer")
          const safeId = (row.id || "").replace(/[^a-zA-Z0-9-_]/g, "_") || "img"
          const ext = ".jpeg"
          const filename = safeId + ext
          const filePath = path.join(this.mediaDir, filename)
          await fs.mkdir(this.mediaDir, { recursive: true })
          await fs.writeFile(filePath, buf)
          row.imageUrl = "/api/media/" + encodeURIComponent(filename)
        } catch (err) {
          LOG.warn({ err }, "Failed to download image")
        }
      }
      delete row.hasImage
      this.onMessage(row)
    }
  }

  resolveWaiters(error) {
    const waiters = [...this.readyWaiters]
    this.readyWaiters = []
    for (const waiter of waiters) {
      if (error) waiter.reject(error)
      else waiter.resolve()
    }
  }
}

export async function setupWhatsAppSession({
  sessionDir,
  qrFilePath,
  timeoutMs = 120000,
  maxRestartAttempts = 4,
  maxAuthResetAttempts = 1,
  onQr = null,
  printQr = true,
}) {
  let attempt = 0
  let authResetCount = 0

  while (attempt <= maxRestartAttempts) {
    attempt += 1
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir)
    const { version } = await fetchLatestBaileysVersion()
    const sock = makeWASocket({
      auth: state,
      version,
      logger: LOG.child({ module: "setup", level: "warn" }),
      markOnlineOnConnect: false,
    })

    sock.ev.on("creds.update", saveCreds)

    try {
      await waitForOpen(sock, {
        timeoutMs,
        onQr: async (qr) => {
          const filePath = await writeQrPng(qr, qrFilePath || path.join(sessionDir, "latest-qr.png"))
          console.log(`Scan WhatsApp QR: ${filePath}`)
          if (onQr) await onQr({ qr, filePath })
        },
        printQr,
      })
      return
    } catch (error) {
      if (isAuthInvalidError(error) && authResetCount < maxAuthResetAttempts) {
        authResetCount += 1
        console.log("Session invalid (401). Resetting local auth and retrying...")
        await resetWhatsAppSession(sessionDir)
        continue
      }
      if (isRestartRequiredError(error) && attempt <= maxRestartAttempts) {
        console.log("WhatsApp requested restart to complete setup. Retrying...")
        continue
      }
      throw error
    } finally {
      try {
        sock.end(undefined)
      } catch {
        // ignore
      }
    }
  }

  throw new Error("WhatsApp setup did not finish after retries")
}

export async function listWhatsAppGroups({ sessionDir, timeoutMs = 120000 }) {
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir)
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    auth: state,
    version,
    logger: LOG.child({ module: "group-discovery", level: "warn" }),
    markOnlineOnConnect: false,
  })

  sock.ev.on("creds.update", saveCreds)
  await waitForOpen(sock, { timeoutMs })

  const groupsMap = await sock.groupFetchAllParticipating()
  const groups = Object.values(groupsMap)
    .map((group) => ({
      id: group.id,
      name: group.subject || group.id,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  try {
    sock.end(undefined)
  } catch {
    // ignore
  }

  return groups
}

export async function resetWhatsAppSession(sessionDir) {
  await fs.rm(sessionDir, { recursive: true, force: true })
}

function toIncomingRows(payload) {
  const messages = Array.isArray(payload?.messages) ? payload.messages : []
  const rows = []

  for (const msg of messages) {
    const remoteJid = msg.key?.remoteJid || ""
    if (!remoteJid.endsWith("@g.us")) continue

    const text = extractText(msg.message)
    const hasImage = hasImageMessage(msg.message)
    if (!text && !hasImage) continue

    rows.push({
      id: msg.key?.id || `${Date.now()}-${Math.random()}`,
      chatId: remoteJid,
      sender: msg.pushName || msg.key?.participant || "Unknown",
      text: text || "[Image]",
      ts: Number(msg.messageTimestamp || Math.floor(Date.now() / 1000)) * 1000,
      fromMe: Boolean(msg.key?.fromMe),
      hasImage: hasImage || undefined,
    })
  }

  return rows
}

function hasImageMessage(message) {
  if (!message || typeof message !== "object") return false
  return Boolean(message.imageMessage)
}

function extractText(message) {
  if (!message || typeof message !== "object") return ""
  if (message.conversation) return String(message.conversation)
  if (message.extendedTextMessage?.text) return String(message.extendedTextMessage.text)
  if (message.imageMessage) return String(message.imageMessage.caption || "[Image]").trim() || ""
  if (message.videoMessage?.caption) return String(message.videoMessage.caption)
  if (message.documentMessage?.caption) return String(message.documentMessage.caption)
  if (message.pollCreationMessage?.name) return `[Poll] ${message.pollCreationMessage.name}`
  return ""
}

function waitForOpen(sock, { timeoutMs, onQr = null, printQr = true }) {
  return new Promise((resolve, reject) => {
    let lastQr = ""
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error("Timed out waiting for WhatsApp login"))
    }, timeoutMs)

    const onConnection = (update) => {
      if (update.qr && update.qr !== lastQr) {
        lastQr = update.qr
        if (onQr) {
          void onQr(update.qr)
        }
        if (printQr) void printTerminalQr(update.qr)
      }

      if (update.connection === "open") {
        cleanup()
        resolve()
        return
      }

      if (update.connection !== "close") return

      const code = update?.lastDisconnect?.error?.output?.statusCode
      if (code === DisconnectReason.restartRequired) {
        cleanup()
        reject(new Error("restart-required"))
        return
      }

      cleanup()
      const err = new Error(`Connection closed before login${code ? ` (status ${code})` : ""}`)
      err.code = code
      reject(err)
    }

    const cleanup = () => {
      clearTimeout(timer)
      sock.ev.off("connection.update", onConnection)
    }

    sock.ev.on("connection.update", onConnection)
  })
}

async function writeQrPng(qrData, outPath) {
  await fs.mkdir(path.dirname(outPath), { recursive: true })
  await QRCode.toFile(outPath, qrData, { margin: 1, scale: 8 })
  return outPath
}

function isRestartRequiredError(error) {
  return error instanceof Error && error.message.includes("restart-required")
}

function isAuthInvalidError(error) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === 401)
}

async function printTerminalQr(qrValue) {
  const qr = await QRCode.toString(qrValue, { type: "terminal", small: false })
  console.log("\nScan this QR with WhatsApp > Linked devices:\n")
  console.log(qr)
}
