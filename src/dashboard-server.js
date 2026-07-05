import fs from "node:fs/promises"
import http from "node:http"
import path from "node:path"
import { WebSocketServer } from "ws"

const MEDIA_FILENAME_REG = /^[a-zA-Z0-9_.-]+\.[a-zA-Z0-9]{1,12}$/

export function createDashboardServer({
  port,
  host = "0.0.0.0",
  mediaDir,
  qrPath = "",
  getState,
  getDesktopStatus = () => ({ onboardingRequired: false, setupPhase: "ready" }),
  onUpdateSettings,
  onUnlockGroups,
  onRefreshGroups = null,
  onCompleteOnboarding = null,
  onRescan = null,
  onLogout = null,
  onForgotPin = null,
  onOpenBrowser = null,
}) {
  const clients = new Set()

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`)

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const desktopStatus = getDesktopStatus()
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      })
      res.end(desktopStatus.onboardingRequired && url.searchParams.get("display") !== "1"
        ? renderOnboardingHtml(getState())
        : renderDashboardHtml())
      return
    }

    if (req.method === "GET" && url.pathname === "/settings") {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      })
      res.end(renderSettingsHtml())
      return
    }

    if (req.method === "GET" && url.pathname === "/onboarding") {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      })
      res.end(renderOnboardingHtml(getState()))
      return
    }

    if (req.method === "GET" && url.pathname === "/api/desktop/status") {
      sendJson(res, 200, {
        ...getDesktopStatus(),
        state: getState(),
      })
      return
    }

    if (req.method === "GET" && url.pathname === "/api/setup/qr.png") {
      if (!qrPath) {
        res.writeHead(404, { "Content-Type": "text/plain", "Cache-Control": "no-store" })
        res.end("Not found")
        return
      }
      try {
        const buf = await fs.readFile(qrPath)
        res.writeHead(200, {
          "Content-Type": "image/png",
          "Cache-Control": "no-store, no-cache, must-revalidate",
        })
        res.end(buf)
      } catch (err) {
        if (err?.code === "ENOENT") {
          res.writeHead(404, { "Content-Type": "text/plain", "Cache-Control": "no-store" })
          res.end("Not found")
        } else {
          res.writeHead(500, { "Content-Type": "text/plain", "Cache-Control": "no-store" })
          res.end("Error")
        }
      }
      return
    }

    if (req.method === "GET" && url.pathname === "/api/state") {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      })
      res.end(JSON.stringify(getState()))
      return
    }

    if (req.method === "POST" && url.pathname === "/api/groups/refresh") {
      if (!onRefreshGroups) {
        sendJson(res, 501, { error: "Group refresh is not available." })
        return
      }
      try {
        const result = await onRefreshGroups(await readJsonBody(req))
        sendJson(res, 200, result)
      } catch (error) {
        sendJson(res, error?.statusCode || 400, { error: errorMessage(error) })
      }
      return
    }

    if (req.method === "POST" && url.pathname === "/api/onboarding/groups") {
      if (!onCompleteOnboarding) {
        sendJson(res, 501, { error: "Onboarding is not available." })
        return
      }
      try {
        const result = await onCompleteOnboarding(await readJsonBody(req))
        sendJson(res, 200, result)
      } catch (error) {
        sendJson(res, error?.statusCode || 400, { error: errorMessage(error) })
      }
      return
    }

    if (req.method === "POST" && url.pathname === "/api/desktop/rescan") {
      if (!onRescan) {
        sendJson(res, 501, { error: "Rescan is not available." })
        return
      }
      try {
        const result = await onRescan(await readJsonBody(req))
        sendJson(res, 200, result)
      } catch (error) {
        sendJson(res, error?.statusCode || 400, { error: errorMessage(error) })
      }
      return
    }

    if (req.method === "POST" && url.pathname === "/api/desktop/logout") {
      if (!onLogout) {
        sendJson(res, 501, { error: "Logout is not available." })
        return
      }
      try {
        const result = await onLogout(await readJsonBody(req))
        sendJson(res, 200, result)
      } catch (error) {
        sendJson(res, error?.statusCode || 400, { error: errorMessage(error) })
      }
      return
    }

    if (req.method === "POST" && url.pathname === "/api/groups/forgot-pin") {
      if (!onForgotPin) {
        sendJson(res, 501, { error: "PIN reset is not available." })
        return
      }
      try {
        const result = await onForgotPin(await readJsonBody(req))
        sendJson(res, 200, result)
      } catch (error) {
        sendJson(res, error?.statusCode || 400, { error: errorMessage(error) })
      }
      return
    }

    if (req.method === "POST" && url.pathname === "/api/desktop/open-browser") {
      if (!onOpenBrowser) {
        sendJson(res, 501, { error: "Open browser is not available." })
        return
      }
      try {
        const result = await onOpenBrowser(await readJsonBody(req))
        sendJson(res, 200, result)
      } catch (error) {
        sendJson(res, error?.statusCode || 400, { error: errorMessage(error) })
      }
      return
    }

    if (req.method === "POST" && url.pathname === "/api/settings") {
      let incoming = {}
      try {
        const raw = await readBody(req)
        incoming = raw ? JSON.parse(raw) : {}
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Invalid JSON payload" }))
        return
      }

      let updated
      try {
        updated = await onUpdateSettings(incoming)
      } catch (error) {
        res.writeHead(error?.statusCode || 400, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store, no-cache, must-revalidate",
        })
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
        return
      }
      broadcast({ type: "state", payload: updated })
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      })
      res.end(JSON.stringify(updated))
      return
    }

    if (req.method === "POST" && url.pathname === "/api/groups/unlock") {
      let incoming = {}
      try {
        const raw = await readBody(req)
        incoming = raw ? JSON.parse(raw) : {}
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Invalid JSON payload" }))
        return
      }

      try {
        const result = await onUnlockGroups(incoming)
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store, no-cache, must-revalidate",
        })
        res.end(JSON.stringify(result))
      } catch (error) {
        res.writeHead(error?.statusCode || 403, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store, no-cache, must-revalidate",
        })
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
      }
      return
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/media/")) {
      const filename = decodeURIComponent(url.pathname.slice("/api/media/".length))
      if (!MEDIA_FILENAME_REG.test(filename) || filename.includes("..")) {
        res.writeHead(400, { "Content-Type": "text/plain" })
        res.end("Bad request")
        return
      }
      const filePath = mediaDir ? path.join(mediaDir, filename) : null
      if (!filePath) {
        res.writeHead(404, { "Content-Type": "text/plain" })
        res.end("Not found")
        return
      }
      try {
        const buf = await fs.readFile(filePath)
        const ext = path.extname(filename).toLowerCase()
        const contentType = contentTypeFromFilename(filename)
        res.writeHead(200, {
          "Content-Type": contentType,
          "Content-Disposition": `inline; filename="${filename.replace(/"/g, "")}"`,
        })
        res.end(buf)
      } catch (err) {
        if (err?.code === "ENOENT") {
          res.writeHead(404, { "Content-Type": "text/plain" })
          res.end("Not found")
        } else {
          res.writeHead(500, { "Content-Type": "text/plain" })
          res.end("Error")
        }
      }
      return
    }

    res.writeHead(404, { "Content-Type": "text/plain" })
    res.end("Not found")
  })

  const wss = new WebSocketServer({ noServer: true })

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`)
    if (url.pathname !== "/ws") {
      socket.destroy()
      return
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws)
    })
  })

  wss.on("connection", (ws) => {
    clients.add(ws)
    ws.send(JSON.stringify({ type: "state", payload: getState() }))

    ws.on("close", () => {
      clients.delete(ws)
    })
  })

  function broadcast(message) {
    const encoded = JSON.stringify(message)
    for (const ws of clients) {
      if (ws.readyState === 1) ws.send(encoded)
    }
  }

  let readyResolve
  let readyReject
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve
    readyReject = reject
  })
  let listenError = null

  server.listen(port, host, () => {
    const url = getServerUrl()
    console.log(`Dashboard running at ${url}`)
    readyResolve()
  })

  server.on("error", (err) => {
    listenError = err
    readyReject(err)
    if (err.code === "EADDRINUSE") {
      console.error(`Port ${port} is already in use. Change it in Settings or stop the other process.`)
    } else {
      console.error("Dashboard server error:", err.message)
    }
  })

  return {
    close: () => new Promise((resolve, reject) => {
      wss.close(() => {
        server.close((error) => {
          if (error && error.code !== "ERR_SERVER_NOT_RUNNING") reject(error)
          else resolve()
        })
      })
    }),
    broadcast,
    ready,
    address: () => server.address(),
    get url() {
      if (listenError) return ""
      return getServerUrl()
    },
  }

  function getServerUrl() {
    const address = server.address()
    const actualPort = typeof address === "object" && address ? address.port : port
    const urlHost = host === "0.0.0.0" ? "localhost" : host
    return `http://${urlHost}:${actualPort}`
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on("data", (chunk) => chunks.push(chunk))
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    req.on("error", reject)
  })
}

async function readJsonBody(req) {
  const raw = await readBody(req)
  if (!raw) return {}
  return JSON.parse(raw)
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store, no-cache, must-revalidate",
  })
  res.end(JSON.stringify(payload))
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function contentTypeFromFilename(filename) {
  const ext = path.extname(filename).toLowerCase()
  if (ext === ".png") return "image/png"
  if (ext === ".gif") return "image/gif"
  if (ext === ".webp") return "image/webp"
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg"
  if (ext === ".pdf") return "application/pdf"
  if (ext === ".txt") return "text/plain; charset=utf-8"
  if (ext === ".mp4") return "video/mp4"
  if (ext === ".mp3") return "audio/mpeg"
  if (ext === ".ogg") return "audio/ogg"
  if (ext === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  if (ext === ".xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  if (ext === ".pptx") return "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  return "application/octet-stream"
}

function renderDashboardHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WhatsApp Command Center</title>
  <style>
    :root {
      --text: #f3f3f3;
      --muted: #9f9f9f;
      --accent: #23d366;
      --msg-size: 42px;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--text);
      font-family: "Avenir Next", "Segoe UI", sans-serif;
      min-height: 100vh;
      background: radial-gradient(circle at 20% 20%, #1f1f1f 0%, #0a0a0a 55%, #000 100%);
      transition: background 120ms linear;
    }
    body.flashing {
      animation: bg-pulse 0.75s linear infinite;
    }
    @keyframes bg-pulse {
      0% { background: radial-gradient(circle at 20% 20%, #4a060f 0%, #220106 58%, #140003 100%); }
      50% { background: radial-gradient(circle at 20% 20%, #b80f24 0%, #5f0714 58%, #30020a 100%); }
      100% { background: radial-gradient(circle at 20% 20%, #4a060f 0%, #220106 58%, #140003 100%); }
    }
    .wrap {
      padding: 16px;
      display: grid;
      gap: 12px;
      grid-template-rows: auto auto 1fr;
      height: 100vh;
    }
    .top {
      background: rgba(0,0,0,0.55);
      border: 1px solid #2f2f2f;
      border-radius: 12px;
      padding: 12px;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }
    .title {
      font-size: 1.2rem;
      font-weight: 700;
      letter-spacing: .04em;
      margin-right: auto;
    }
    .group-names {
      width: 100%;
      color: var(--muted);
      font-size: .86rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .badge {
      padding: 6px 10px;
      border-radius: 999px;
      font-weight: 700;
      font-size: .8rem;
      background: #2b2b2b;
      color: #ddd;
    }
    .badge.ok { background: #144824; color: #8cf3b2; }
    .controls {
      background: rgba(0,0,0,0.55);
      border: 1px solid #2f2f2f;
      border-radius: 12px;
      padding: 12px;
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: center;
    }
    .note { color: var(--muted); }
    button, a.btn {
      border-radius: 8px;
      border: 1px solid #3a3a3a;
      background: #191919;
      color: var(--text);
      padding: 8px 10px;
      font-size: .95rem;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
    }
    a.btn.primary {
      background: var(--accent);
      border-color: var(--accent);
      color: #06120b;
      font-weight: 800;
    }
    .danger { border-color: #8c1b27; background: #3a0d13; }
    .messages {
      overflow-y: auto;
      border: 1px solid #2f2f2f;
      border-radius: 12px;
      background: rgba(0,0,0,0.52);
      padding: 14px;
      display: grid;
      gap: 12px;
      align-content: start;
    }
    .msg {
      border: 1px solid #2f2f2f;
      border-left: 6px solid var(--accent);
      border-radius: 10px;
      padding: 12px;
      background: #151515;
    }
    .meta {
      color: var(--muted);
      font-size: .92rem;
      margin-bottom: 8px;
    }
    .text {
      font-size: clamp(16px, var(--msg-size), 120px);
      line-height: 1.25;
      font-weight: 700;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .msg-media {
      margin-top: 8px;
      display: flex;
      align-items: flex-start;
      gap: 8px;
      flex-wrap: wrap;
    }
    .msg-thumb {
      position: relative;
      flex-shrink: 0;
    }
    .msg-thumb img.msg-thumb-img {
      display: block;
      max-width: 240px;
      max-height: 240px;
      width: auto;
      height: auto;
      border-radius: 8px;
      border: 1px solid #2f2f2f;
      cursor: pointer;
    }
    .msg-thumb img.msg-thumb-img:hover { opacity: 0.9; }
    .msg-thumb .download-btn {
      position: absolute;
      bottom: 6px;
      right: 6px;
      width: 28px;
      height: 28px;
      border-radius: 6px;
      background: rgba(0,0,0,0.7);
      color: var(--text);
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      text-decoration: none;
      padding: 0;
    }
    .msg-thumb .download-btn:hover { background: rgba(35,211,102,0.9); color: #000; }
    .attachment-card {
      display: inline-grid;
      gap: 4px;
      min-width: min(340px, 100%);
      border: 1px solid #343d38;
      border-radius: 8px;
      background: #101513;
      padding: 10px;
      color: var(--text);
      text-decoration: none;
    }
    .attachment-card:hover { border-color: var(--accent); }
    .attachment-name { font-weight: 800; overflow-wrap: anywhere; }
    .attachment-meta { color: var(--muted); font-size: .86rem; }
    .img-modal-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.9);
      z-index: 9999;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    .img-modal-overlay.open { display: flex; }
    .img-modal-content {
      max-width: 95vw;
      max-height: 95vh;
      object-fit: contain;
      pointer-events: none;
    }
    .img-modal-close {
      position: absolute;
      top: 16px;
      right: 16px;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: rgba(255,255,255,0.15);
      color: var(--text);
      border: 1px solid rgba(255,255,255,0.3);
      font-size: 24px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
      pointer-events: auto;
    }
    .img-modal-close:hover { background: rgba(255,255,255,0.25); }
    .empty {
      color: var(--muted);
      font-size: 1.2rem;
      text-align: center;
      margin-top: 20px;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="top">
      <div class="title">WhatsApp Command Center</div>
      <div id="wa-badge" class="badge">WhatsApp: Disconnected</div>
      <div id="groups-badge" class="badge">Groups: 0</div>
      <div id="groups-names" class="group-names">Watched groups: none</div>
    </div>

    <div class="controls">
      <span id="filter-note" class="note">Filter: all messages</span>
      <span id="pulse-note" class="note">Pulse: off</span>
      <a class="btn primary" href="/onboarding">Connect WhatsApp</a>
      <a class="btn" href="/settings">Settings</a>
      <button id="open-browser">Open Browser</button>
      <button id="copy-link">Copy Link</button>
      <button id="stop-flash" class="danger">Stop Flash (S)</button>
      <button id="fullscreen">Fullscreen</button>
      <span id="link-status" class="note"></span>
    </div>

    <div id="messages" class="messages"></div>
  </div>

  <div id="img-modal" class="img-modal-overlay" aria-hidden="true">
    <img id="img-modal-img" class="img-modal-content" src="" alt="Full size">
    <button type="button" id="img-modal-close" class="img-modal-close" aria-label="Close">&times;</button>
  </div>

  <script>
    const messagesEl = document.getElementById('messages');
    const waBadge = document.getElementById('wa-badge');
    const groupsBadge = document.getElementById('groups-badge');
    const groupsNames = document.getElementById('groups-names');
    const filterNote = document.getElementById('filter-note');
    const pulseNote = document.getElementById('pulse-note');
    const openBrowserBtn = document.getElementById('open-browser');
    const copyLinkBtn = document.getElementById('copy-link');
    const linkStatus = document.getElementById('link-status');
    const stopFlashBtn = document.getElementById('stop-flash');
    const fullscreenBtn = document.getElementById('fullscreen');

    let state = { messages: [], connected: false, watchedGroups: [], keywordMode: 'all', keywords: [], pulseEnabled: false, pulseMode: 'all', pulseKeywords: [], flashMode: 'all', messageFontSize: 42, showImages: true, groupKeywords: {} };

    function render() {
      waBadge.textContent = 'WhatsApp: ' + (state.connected ? 'Connected' : 'Disconnected');
      waBadge.className = 'badge ' + (state.connected ? 'ok' : '');
      groupsBadge.textContent = 'Groups: ' + (state.watchedGroups || []).length;
      const names = (state.watchedGroups || []).map((group) => group.name || group.id).filter(Boolean);
      groupsNames.textContent = 'Watched groups: ' + (names.length ? names.join(', ') : 'none');
      document.documentElement.style.setProperty('--msg-size', String(state.messageFontSize || 42) + 'px');

      const keywords = state.keywords || [];
      if (state.keywordMode === 'keywords') {
        filterNote.textContent = 'Filter: keyword mode (' + (keywords.join(', ') || 'no keywords set') + ')';
      } else {
        filterNote.textContent = 'Filter: all messages';
      }

      if (state.pulseEnabled) {
        if (state.pulseMode === 'keywords') {
          const pulseKeywords = state.pulseKeywords || [];
          pulseNote.textContent = 'Pulse: on (keyword mode: ' + (pulseKeywords.join(', ') || 'no keywords set') + ')';
        } else {
          pulseNote.textContent = 'Pulse: on (all messages)';
        }
      } else {
        pulseNote.textContent = 'Pulse: off';
        document.body.classList.remove('flashing');
      }

      const rows = (state.messages || []).slice().reverse();
      if (!rows.length) {
        messagesEl.innerHTML = '<div class="empty">No messages yet.</div>';
        return;
      }

      messagesEl.innerHTML = rows.map((msg) => {
        const ts = new Date(msg.ts).toLocaleString();
        const hasImage = state.showImages && msg.imageUrl;
        const text = msg.text || '';
        const isImageOnly = hasImage && (text === '' || text === '[Image]');
        let textHtml = '';
        if (!isImageOnly && text) {
          textHtml = '<div class="text">' + escapeHtml(text) + '</div>';
        }
        let mediaHtml = '';
        if (hasImage) {
          const fullUrl = msg.imageUrl.startsWith('http') ? msg.imageUrl : (location.origin + msg.imageUrl);
          mediaHtml = '<div class="msg-media"><div class="msg-thumb">'
            + '<img class="msg-thumb-img" src="' + escapeAttr(msg.imageUrl) + '" alt="Attachment" data-full="' + escapeAttr(fullUrl) + '">'
            + '<a class="download-btn" href="' + escapeAttr(fullUrl) + '" download title="Download image" onclick="event.stopPropagation()">&#8595;</a>'
            + '</div></div>';
        } else if (msg.attachment && msg.attachment.url) {
          const fileUrl = msg.attachment.url.startsWith('http') ? msg.attachment.url : (location.origin + msg.attachment.url);
          const fileName = msg.attachment.fileName || 'attachment';
          const meta = [msg.attachment.mimeType || 'file', formatBytes(msg.attachment.size)].filter(Boolean).join(' | ');
          mediaHtml = '<div class="msg-media">'
            + '<a class="attachment-card" href="' + escapeAttr(fileUrl) + '" target="_blank" rel="noopener" download>'
            + '<span class="attachment-name">' + escapeHtml(fileName) + '</span>'
            + '<span class="attachment-meta">' + escapeHtml(meta) + '</span>'
            + '</a></div>';
        }
        return '<div class="msg">'
          + '<div class="meta">' + escapeHtml(msg.groupName || msg.chatId) + ' | ' + escapeHtml(msg.sender || 'Unknown') + ' | ' + ts + '</div>'
          + textHtml
          + mediaHtml
          + '</div>';
      }).join('');
    }

    function escapeHtml(value) {
      const div = document.createElement('div');
      div.textContent = String(value || '');
      return div.innerHTML;
    }
    function escapeAttr(value) {
      const div = document.createElement('div');
      div.textContent = String(value || '');
      return div.innerHTML.replace(/"/g, '&quot;');
    }

    function stopFlash() {
      document.body.classList.remove('flashing');
    }

    function formatBytes(value) {
      const size = Number(value || 0);
      if (!size) return '';
      if (size < 1024) return size + ' B';
      if (size < 1024 * 1024) return Math.round(size / 1024) + ' KB';
      return (size / (1024 * 1024)).toFixed(1) + ' MB';
    }

    async function copyDisplayLink() {
      const url = location.origin + '/?display=1';
      try {
        await navigator.clipboard.writeText(url);
        linkStatus.textContent = 'Link copied.';
      } catch {
        linkStatus.textContent = url;
      }
    }

    stopFlashBtn.onclick = stopFlash;

    openBrowserBtn.onclick = async () => {
      const invoke = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;
      if (invoke) {
        try {
          await invoke('open_in_browser');
          return;
        } catch {
          // Fall through to browser behavior.
        }
      }
      try {
        const res = await fetch('/api/desktop/open-browser', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        if (res.ok) return;
      } catch {
        // Fall through to browser behavior.
      }
      window.open(location.origin + '/?display=1', '_blank', 'noopener');
    };

    copyLinkBtn.onclick = copyDisplayLink;

    document.addEventListener('keydown', (event) => {
      if (event.key.toLowerCase() === 's') stopFlash();
    });

    fullscreenBtn.onclick = async () => {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    };

    const imgModal = document.getElementById('img-modal');
    const imgModalImg = document.getElementById('img-modal-img');
    const imgModalClose = document.getElementById('img-modal-close');

    function openImageModal(src) {
      imgModalImg.src = src;
      imgModal.classList.add('open');
      imgModal.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    }
    function closeImageModal() {
      imgModal.classList.remove('open');
      imgModal.setAttribute('aria-hidden', 'true');
      imgModalImg.src = '';
      document.body.style.overflow = '';
    }

    imgModalClose.onclick = (e) => { e.stopPropagation(); closeImageModal(); };
    imgModal.onclick = (e) => { if (e.target === imgModal) closeImageModal(); };
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && imgModal.classList.contains('open')) closeImageModal();
    });

    messagesEl.addEventListener('click', (e) => {
      const thumb = e.target.closest('.msg-thumb-img');
      if (thumb && thumb.dataset.full) openImageModal(thumb.dataset.full);
    });

    function onSocketMessage(event) {
      const parsed = JSON.parse(event.data);
      if (parsed.type === 'state') {
        state = parsed.payload;
        render();
        return;
      }

      if (parsed.type === 'new-message') {
        const payload = parsed.payload || {};
        const message = payload.message || payload;
        state.messages = (state.messages || []).concat(message).slice(-500);
        if (payload.flash) {
          document.body.classList.add('flashing');
        }
        render();
      }
    }

    async function init() {
      const first = await fetch('/api/state').then((r) => r.json());
      state = first;
      render();

      const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(wsProtocol + '//' + location.host + '/ws');
      ws.onmessage = onSocketMessage;
    }

    init();
  </script>
</body>
</html>`
}

function renderOnboardingHtml(state = {}) {
  const initialHasGroupPin = Boolean(state?.hasGroupPin)
  const pinGateClass = initialHasGroupPin ? "pin-gate" : "pin-gate hidden"
  const protectedFlowClass = initialHasGroupPin ? "hidden" : ""
  const groupsSectionClass = initialHasGroupPin ? "panel hidden" : "panel"
  const initialMessage = initialHasGroupPin
    ? "Group PIN required before connecting WhatsApp or changing groups."
    : ""
  const qrSrc = initialHasGroupPin ? "" : ' src="/api/setup/qr.png"'

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Setup - WhatsApp Command Center</title>
  <style>
    :root {
      --bg: #101312;
      --panel: #191d1b;
      --panel-2: #111614;
      --line: #2c3832;
      --text: #f2f6f3;
      --muted: #9aa8a0;
      --accent: #23d366;
      --warn: #f2c14e;
      --danger: #d84f5f;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: linear-gradient(135deg, #101312 0%, #17221c 48%, #0a0d0c 100%);
      color: var(--text);
      font-family: "Avenir Next", "Segoe UI", sans-serif;
    }
    .shell {
      min-height: 100vh;
      display: grid;
      grid-template-columns: minmax(280px, 420px) minmax(320px, 1fr);
      gap: 16px;
      padding: 16px;
    }
    .panel {
      background: rgba(25,29,27,0.92);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 16px;
      min-width: 0;
    }
    .qr-panel {
      display: grid;
      align-content: start;
      gap: 14px;
    }
    h1, h2 { margin: 0; letter-spacing: 0; }
    h1 { font-size: 1.45rem; }
    h2 { font-size: 1rem; color: var(--muted); font-weight: 650; }
    .status {
      display: inline-flex;
      width: fit-content;
      border: 1px solid var(--line);
      background: var(--panel-2);
      border-radius: 999px;
      padding: 6px 10px;
      color: var(--muted);
      font-weight: 700;
      font-size: .86rem;
    }
    .status.ready { color: #06120b; background: var(--accent); border-color: var(--accent); }
    .qr-wrap {
      display: grid;
      place-items: center;
      min-height: 300px;
      border: 1px dashed #456056;
      background: #eef5ef;
      border-radius: 8px;
      padding: 14px;
    }
    .qr-wrap img {
      width: min(280px, 76vw);
      height: auto;
      image-rendering: pixelated;
    }
    .muted { color: var(--muted); }
    .actions, .row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }
    button, a.btn, input[type="search"], input[type="password"] {
      border-radius: 8px;
      border: 1px solid #3b4a44;
      background: #121715;
      color: var(--text);
      padding: 9px 11px;
      font-size: .95rem;
    }
    button, a.btn {
      cursor: pointer;
      text-decoration: none;
      font-weight: 700;
    }
    button.primary { background: var(--accent); border-color: var(--accent); color: #06120b; }
    button.danger { border-color: #7b2833; background: #351217; color: #ffd7dd; }
    input[type="search"] { width: 100%; }
    input[type="password"] { width: min(260px, 100%); }
    .hidden { display: none !important; }
    .pin-gate {
      display: grid;
      gap: 10px;
      border: 1px solid #45584f;
      border-radius: 8px;
      background: rgba(17,22,20,0.9);
      padding: 12px;
    }
    .groups {
      display: grid;
      gap: 10px;
      max-height: calc(100vh - 210px);
      overflow: auto;
      padding-right: 2px;
    }
    .group-row {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 10px;
      align-items: center;
      background: rgba(17,22,20,0.82);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px;
    }
    .group-row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .empty {
      color: var(--muted);
      border: 1px dashed var(--line);
      border-radius: 8px;
      padding: 16px;
      text-align: center;
    }
    #message { min-height: 1.4em; color: var(--warn); }
    @media (max-width: 760px) {
      .shell { grid-template-columns: 1fr; }
      .groups { max-height: none; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <section class="panel qr-panel">
      <div>
        <h1>Connect WhatsApp / Groups</h1>
        <div class="muted">Use WhatsApp Linked devices, then choose which groups appear on the display.</div>
      </div>
      <div id="phase" class="status">Starting</div>
      <div id="pin-gate" class="${pinGateClass}">
        <strong>Group PIN required</strong>
        <div class="muted">Enter the group PIN to connect WhatsApp or edit groups. If you forgot it, logout of WhatsApp and reset the PIN.</div>
        <div class="actions">
          <input id="group-pin" type="password" inputmode="numeric" pattern="[0-9]*" placeholder="Enter PIN">
          <button id="unlock-pin" class="primary" type="button">Unlock</button>
          <button id="forgot-pin" class="danger" type="button">Forgot PIN</button>
        </div>
      </div>
      <div id="protected-flow" class="${protectedFlowClass}">
        <div class="qr-wrap">
          <img id="qr" alt="WhatsApp QR code"${qrSrc}>
        </div>
        <div class="actions">
          <button id="rescan" class="danger" type="button">Logout and rescan</button>
          <a class="btn" href="/?display=1">Open display</a>
          <button id="copy-link" type="button">Copy Link</button>
        </div>
      </div>
      <div id="message">${escapeHtml(initialMessage)}</div>
    </section>

    <section id="groups-section" class="${groupsSectionClass}">
      <div class="row" style="justify-content:space-between; margin-bottom: 12px;">
        <div>
          <h2>Groups</h2>
          <div id="group-count" class="muted">No groups loaded</div>
        </div>
        <button id="refresh" type="button">Refresh groups</button>
      </div>
      <input id="search" type="search" placeholder="Search groups by name">
      <div id="groups" class="groups" style="margin-top: 10px;"></div>
      <div class="actions" style="margin-top: 12px;">
        <button id="save" class="primary" type="button">Save selected groups</button>
      </div>
    </section>
  </main>

  <script>
    const phaseEl = document.getElementById('phase');
    const qrEl = document.getElementById('qr');
    const messageEl = document.getElementById('message');
    const pinGate = document.getElementById('pin-gate');
    const protectedFlow = document.getElementById('protected-flow');
    const groupsSection = document.getElementById('groups-section');
    const groupPinInput = document.getElementById('group-pin');
    const unlockPinBtn = document.getElementById('unlock-pin');
    const forgotPinBtn = document.getElementById('forgot-pin');
    const groupsEl = document.getElementById('groups');
    const groupCountEl = document.getElementById('group-count');
    const searchEl = document.getElementById('search');
    const refreshBtn = document.getElementById('refresh');
    const saveBtn = document.getElementById('save');
    const rescanBtn = document.getElementById('rescan');
    const copyLinkBtn = document.getElementById('copy-link');

    let knownGroups = [];
    let knownGroupSignature = '';
    let selectedIds = new Set();
    let qrWasAvailable = false;
    let hasGroupPin = ${initialHasGroupPin ? "true" : "false"};
    let groupPinAuth = '';

    function setMessage(value) {
      messageEl.textContent = value || '';
    }

    function setPhase(value) {
      const label = String(value || 'starting').replaceAll('_', ' ');
      phaseEl.textContent = label.charAt(0).toUpperCase() + label.slice(1);
      phaseEl.classList.toggle('ready', value === 'ready' || value === 'connected');
    }

    function updateLockUi() {
      const locked = hasGroupPin && !groupPinAuth;
      pinGate.classList.toggle('hidden', !locked);
      protectedFlow.classList.toggle('hidden', locked);
      groupsSection.classList.toggle('hidden', locked);
      if (locked) setMessage('Group PIN required before connecting WhatsApp or changing groups.');
    }

    function renderGroups() {
      const term = searchEl.value.trim().toLowerCase();
      const filtered = knownGroups.filter((group) =>
        String(group.name || group.id).toLowerCase().includes(term)
      );
      groupCountEl.textContent = knownGroups.length
        ? String(selectedIds.size) + ' selected from ' + String(knownGroups.length)
        : 'No groups loaded';
      if (!filtered.length) {
        groupsEl.innerHTML = '<div class="empty">No groups found. Scan the QR, then refresh groups.</div>';
        return;
      }
      groupsEl.innerHTML = filtered.map((group) => {
        const checked = selectedIds.has(group.id) ? 'checked' : '';
        return '<label class="group-row">'
          + '<input type="checkbox" data-id="' + escapeAttr(group.id) + '" ' + checked + '>'
          + '<span>' + escapeHtml(group.name || group.id) + '</span>'
          + '</label>';
      }).join('');
    }

    async function loadStatus() {
      const status = await fetch('/api/desktop/status').then((r) => r.json());
      setPhase(status.setupPhase);
      const state = status.state || {};
      hasGroupPin = Boolean(state.hasGroupPin);
      updateLockUi();
      if (hasGroupPin && !groupPinAuth) return;
      if (status.qrAvailable && !qrWasAvailable) {
        qrEl.src = '/api/setup/qr.png?ts=' + Date.now();
      }
      qrWasAvailable = Boolean(status.qrAvailable);

      const nextKnownGroups = mergeGroups(state.knownGroups || [], state.watchedGroups || []);
      const nextSignature = JSON.stringify(nextKnownGroups);
      if (nextSignature !== knownGroupSignature) {
        knownGroups = nextKnownGroups;
        knownGroupSignature = nextSignature;
        (state.watchedGroups || []).forEach((group) => selectedIds.add(group.id));
        renderGroups();
      }
    }

    async function refreshGroups() {
      setMessage('Refreshing groups...');
      const res = await fetch('/api/groups/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pin: groupPinAuth }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(body.error || 'Could not refresh groups.');
        return;
      }
      knownGroups = mergeGroups(body.knownGroups || [], body.watchedGroups || []);
      knownGroupSignature = JSON.stringify(knownGroups);
      setMessage('Groups refreshed.');
      renderGroups();
    }

    async function saveGroups() {
      const watchedGroups = knownGroups.filter((group) => selectedIds.has(group.id));
      const res = await fetch('/api/onboarding/groups', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ watchedGroups, groupPinAuth }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(body.error || 'Could not save groups.');
        return;
      }
      setMessage('Groups saved. Opening display...');
      setTimeout(() => { location.href = '/'; }, 400);
    }

    async function unlockPin() {
      const pin = groupPinInput.value.trim();
      const res = await fetch('/api/groups/unlock', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(body.error || 'PIN is incorrect.');
        return;
      }
      groupPinAuth = pin;
      knownGroups = mergeGroups(body.knownGroups || [], body.watchedGroups || []);
      knownGroupSignature = JSON.stringify(knownGroups);
      selectedIds = new Set((body.watchedGroups || []).map((group) => group.id));
      updateLockUi();
      renderGroups();
      setMessage('Unlocked.');
    }

    async function forgotPin() {
      setMessage('Logging out of WhatsApp and resetting PIN...');
      const res = await fetch('/api/groups/forgot-pin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(body.error || 'Could not reset PIN.');
        return;
      }
      hasGroupPin = false;
      groupPinAuth = '';
      groupPinInput.value = '';
      selectedIds = new Set();
      updateLockUi();
      setPhase(body.setupPhase || 'waiting_for_qr');
      qrWasAvailable = false;
      qrEl.src = '/api/setup/qr.png?ts=' + Date.now();
      setMessage('PIN reset. Scan WhatsApp again, then create a new PIN in Settings.');
    }

    async function rescan() {
      setMessage('Starting a fresh QR...');
      const res = await fetch('/api/desktop/rescan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(body.error || 'Could not start rescan.');
        return;
      }
      setPhase(body.setupPhase || 'waiting_for_qr');
      qrWasAvailable = false;
      qrEl.src = '/api/setup/qr.png?ts=' + Date.now();
    }

    groupsEl.addEventListener('change', (event) => {
      const target = event.target;
      if (!target || target.type !== 'checkbox') return;
      const id = target.getAttribute('data-id');
      if (!id) return;
      if (target.checked) selectedIds.add(id);
      else selectedIds.delete(id);
      renderGroups();
    });

    searchEl.addEventListener('input', renderGroups);
    unlockPinBtn.onclick = unlockPin;
    forgotPinBtn.onclick = forgotPin;
    refreshBtn.onclick = refreshGroups;
    saveBtn.onclick = saveGroups;
    rescanBtn.onclick = rescan;
    copyLinkBtn.onclick = async () => {
      const url = location.origin + '/?display=1';
      try {
        await navigator.clipboard.writeText(url);
        setMessage('Link copied.');
      } catch {
        setMessage(url);
      }
    };

    function mergeGroups(a, b) {
      const byId = new Map();
      [a, b].forEach((list) => {
        (Array.isArray(list) ? list : []).forEach((group) => {
          const id = String(group && group.id || '').trim();
          if (!id) return;
          const name = String(group && group.name || '').trim();
          if (!byId.has(id)) byId.set(id, { id, name: name || id });
          else if (name && byId.get(id).name === id) byId.set(id, { id, name });
        });
      });
      return Array.from(byId.values()).sort((x, y) => x.name.localeCompare(y.name));
    }

    function escapeHtml(value) {
      const div = document.createElement('div');
      div.textContent = String(value || '');
      return div.innerHTML;
    }

    function escapeAttr(value) {
      return escapeHtml(value).replace(/"/g, '&quot;');
    }

    loadStatus().catch((error) => setMessage(error.message || String(error)));
    setInterval(() => {
      loadStatus().catch((error) => setMessage(error.message || String(error)));
    }, 1500);
  </script>
</body>
</html>`
}

function renderSettingsHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Settings - WhatsApp Command Center</title>
  <style>
    * { box-sizing: border-box; }
    :root {
      --bg: #0c0f0e;
      --panel: #151a18;
      --panel-2: #101412;
      --panel-3: #0d1110;
      --line: #2a3430;
      --line-strong: #3e4d47;
      --text: #f4f7f5;
      --muted: #9ca9a3;
      --accent: #23d366;
      --accent-2: #8cf3b2;
      --danger: #ff6b7a;
      --danger-bg: #321217;
      --focus: #c4f7d6;
    }
    body {
      margin: 0;
      background: radial-gradient(circle at 18% 0%, rgba(35,211,102,0.08), transparent 34%), var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Avenir Next", "Segoe UI", sans-serif;
      min-height: 100vh;
      padding: 18px;
    }
    .settings-shell {
      width: min(1120px, 100%);
      margin: 0 auto;
      display: grid;
      gap: 12px;
    }
    .settings-header, .settings-footer {
      position: sticky;
      z-index: 3;
      background: rgba(12,15,14,0.92);
      border: 1px solid var(--line);
      backdrop-filter: blur(14px);
      border-radius: 8px;
      padding: 12px;
      display: flex;
      gap: 12px;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
    }
    .settings-header { top: 10px; }
    .settings-footer { bottom: 10px; }
    .title-block { display: grid; gap: 3px; min-width: 220px; }
    h1 { margin: 0; font-size: 1.45rem; letter-spacing: 0; }
    h2 { margin: 0; font-size: 1rem; letter-spacing: 0; }
    .muted { color: var(--muted); }
    .settings-section {
      background: rgba(21,26,24,0.92);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px;
      display: grid;
      gap: 12px;
    }
    .section-heading {
      display: flex;
      gap: 10px;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      border-bottom: 1px solid var(--line);
      padding-bottom: 10px;
    }
    .heading-copy { display: grid; gap: 2px; }
    .heading-title { display: flex; gap: 8px; align-items: center; }
    .icon {
      display: inline-grid;
      place-items: center;
      width: 24px;
      height: 24px;
      border-radius: 7px;
      background: #203028;
      color: var(--accent-2);
      font-size: 0.92rem;
      line-height: 1;
      flex: 0 0 auto;
    }
    label { display: inline-flex; gap: 8px; align-items: center; }
    .field { display: grid; gap: 6px; min-width: 0; }
    .field-label { color: var(--muted); font-size: .82rem; font-weight: 700; }
    .control-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(220px, 1fr));
      gap: 10px;
    }
    input[type="text"], input[type="number"], select, textarea {
      width: 100%;
      border-radius: 8px;
      border: 1px solid var(--line-strong);
      background: var(--panel-3);
      color: var(--text);
      padding: 10px;
      font-size: 1rem;
      min-height: 42px;
      outline: none;
    }
    input:focus, select:focus, textarea:focus, button:focus-visible, a:focus-visible {
      outline: 2px solid var(--focus);
      outline-offset: 2px;
    }
    textarea {
      min-height: 74px;
      resize: vertical;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: .9rem;
    }
    input[type="checkbox"] {
      accent-color: var(--accent);
    }
    .switch {
      min-height: 42px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 9px 10px;
      background: var(--panel-2);
      color: var(--text);
    }
    .group-list {
      display: grid;
      gap: 8px;
      max-height: 280px;
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px;
      background: var(--panel-2);
    }
    .group-row {
      display: grid;
      grid-template-columns: auto minmax(140px, 1fr) minmax(220px, 1.3fr);
      align-items: center;
      gap: 8px;
    }
    .group-row input[type="text"] {
      padding: 7px 9px;
      font-size: .93rem;
    }
    .webhook-list {
      display: grid;
      gap: 10px;
    }
    .empty-note {
      border: 1px dashed var(--line-strong);
      border-radius: 8px;
      color: var(--muted);
      padding: 12px;
      background: var(--panel-2);
    }
    .webhook-card {
      display: grid;
      gap: 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel-2);
      padding: 12px;
    }
    .webhook-card-header {
      display: flex;
      gap: 10px;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
    }
    .webhook-summary {
      display: flex;
      gap: 8px;
      align-items: center;
      min-width: 220px;
    }
    .webhook-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(180px, 1fr));
      gap: 10px;
    }
    .webhook-wide { grid-column: 1 / -1; }
    .conditional.hidden { display: none !important; }
    @media (max-width: 760px) {
      body { padding: 10px; }
      .settings-header, .settings-footer { position: static; }
      .control-grid { grid-template-columns: 1fr; }
      .webhook-grid { grid-template-columns: 1fr; }
      .webhook-wide { grid-column: auto; }
    }
    .row-inline { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .hidden { display: none; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; }
    button, a {
      border-radius: 8px;
      border: 1px solid var(--line-strong);
      background: #1b211f;
      color: var(--text);
      padding: 10px 12px;
      font-size: .95rem;
      text-decoration: none;
      cursor: pointer;
      display: inline-flex;
      gap: 7px;
      align-items: center;
      justify-content: center;
      min-height: 42px;
      font-weight: 700;
    }
    button:hover, a:hover { border-color: #587066; background: #202a26; }
    .primary {
      background: var(--accent);
      border-color: var(--accent);
      color: #06120b;
    }
    .danger {
      border-color: #75313a;
      background: var(--danger-bg);
      color: #ffd7dd;
    }
    .ghost {
      background: transparent;
    }
    #status { color: var(--accent-2); min-height: 1.2em; }
  </style>
</head>
<body>
  <main class="settings-shell">
    <header class="settings-header">
      <div class="title-block">
        <h1>Settings</h1>
        <div class="muted">Tune the display, group access, and automations.</div>
      </div>
      <div class="actions">
        <button id="save" class="primary" type="button"><span class="icon" aria-hidden="true">&#10003;</span> Save changes</button>
        <a class="ghost" href="/?display=1"><span class="icon" aria-hidden="true">&#8592;</span> Display</a>
      </div>
    </header>

    <section class="settings-section">
      <div class="section-heading">
        <div class="heading-copy">
          <div class="heading-title"><span class="icon" aria-hidden="true">&#9638;</span><h2>Display</h2></div>
          <div class="muted">Control what appears on the public screen.</div>
        </div>
      </div>
      <div class="control-grid">
        <label class="switch"><input id="show-images" type="checkbox" checked> Show images in messages</label>
        <div class="field">
          <label class="field-label" for="font-size">Message font size</label>
          <input id="font-size" type="number" min="16" max="120" step="1">
        </div>
      </div>
    </section>

    <section class="settings-section">
      <div class="section-heading">
        <div class="heading-copy">
          <div class="heading-title"><span class="icon" aria-hidden="true">&#8981;</span><h2>Filters and pulse</h2></div>
          <div class="muted">Limit visible messages and control the flash behavior.</div>
        </div>
      </div>
      <div class="control-grid">
        <label class="switch"><input id="keyword-toggle" type="checkbox"> Only show keyword matches</label>
        <div class="field">
          <label class="field-label" for="keywords">Message keywords</label>
          <input id="keywords" type="text" placeholder="urgent, dispatch, safety">
        </div>
        <label class="switch"><input id="pulse-enabled" type="checkbox"> Pulse on new messages</label>
        <div class="field">
          <label class="field-label" for="pulse-mode">Pulse behavior</label>
          <select id="pulse-mode">
            <option value="all">Pulse on all shown messages</option>
            <option value="keywords">Pulse on keyword matches only</option>
          </select>
        </div>
        <div id="pulse-keywords-wrap" class="field webhook-wide hidden">
          <label class="field-label" for="pulse-keywords">Pulse keywords</label>
          <input id="pulse-keywords" type="text" placeholder="urgent, escalation, outage">
        </div>
      </div>
    </section>

    <section class="settings-section">
      <div class="section-heading">
        <div class="heading-copy">
          <div class="heading-title"><span class="icon" aria-hidden="true">&#128274;</span><h2>Groups and PIN</h2></div>
          <div class="muted">Unlock group management before changing watched groups or group keywords.</div>
        </div>
        <div id="pin-note" class="muted"></div>
      </div>
      <div class="control-grid">
        <div class="field">
          <label class="field-label" for="groups-pin">Group PIN</label>
          <input id="groups-pin" type="password" inputmode="numeric" pattern="[0-9]*" placeholder="Enter PIN">
        </div>
        <div class="row-inline">
          <button id="unlock-groups" type="button"><span class="icon" aria-hidden="true">&#128275;</span> Unlock groups</button>
          <button id="forgot-pin" class="danger" type="button"><span class="icon" aria-hidden="true">&#8635;</span> Forgot PIN</button>
        </div>
        <div class="field">
          <label class="field-label" for="pin-current">Current PIN</label>
          <input id="pin-current" type="password" inputmode="numeric" pattern="[0-9]*" placeholder="Current PIN if set">
        </div>
        <div class="field">
          <label class="field-label" for="pin-new">New PIN</label>
          <input id="pin-new" type="password" inputmode="numeric" pattern="[0-9]*" placeholder="4-8 digits">
        </div>
      </div>
      <div id="groups-panel" class="hidden">
        <div class="row-inline">
          <button id="refresh-groups" type="button"><span class="icon" aria-hidden="true">&#10227;</span> Refresh groups</button>
        </div>
        <div class="field" style="margin-top:10px;">
          <label class="field-label" for="group-search">Search groups</label>
          <input id="group-search" type="text" placeholder="Search groups by name">
        </div>
        <div id="group-list" class="group-list" style="margin-top:10px;"></div>
      </div>
    </section>

    <section class="settings-section">
      <div class="section-heading">
        <div class="heading-copy">
          <div class="heading-title"><span class="icon" aria-hidden="true">&#8644;</span><h2>Webhooks</h2></div>
          <div class="muted">Call external systems from watched messages. Use {{text}}, {{sender}}, {{groupName}}, {{chatId}}, {{messageId}}, {{match1}}, or named regex groups.</div>
        </div>
        <button id="add-webhook" type="button" aria-label="Add webhook"><span class="icon" aria-hidden="true">&#43;</span> Add webhook</button>
      </div>
      <div id="webhook-list" class="webhook-list"></div>
    </section>

    <footer class="settings-footer">
      <div id="status"></div>
      <div class="actions">
        <button id="save-footer" class="primary" type="button"><span class="icon" aria-hidden="true">&#10003;</span> Save changes</button>
        <a class="ghost" href="/?display=1"><span class="icon" aria-hidden="true">&#8592;</span> Display</a>
      </div>
    </footer>
  </main>

  <script>
    const showImagesInput = document.getElementById('show-images');
    const keywordToggle = document.getElementById('keyword-toggle');
    const keywordsInput = document.getElementById('keywords');
    const pulseEnabledInput = document.getElementById('pulse-enabled');
    const pulseModeInput = document.getElementById('pulse-mode');
    const pulseKeywordsWrap = document.getElementById('pulse-keywords-wrap');
    const pulseKeywordsInput = document.getElementById('pulse-keywords');
    const fontSizeInput = document.getElementById('font-size');
    const pinNote = document.getElementById('pin-note');
    const groupsPinInput = document.getElementById('groups-pin');
    const unlockGroupsBtn = document.getElementById('unlock-groups');
    const pinCurrentInput = document.getElementById('pin-current');
    const pinNewInput = document.getElementById('pin-new');
    const groupsPanel = document.getElementById('groups-panel');
    const refreshGroupsBtn = document.getElementById('refresh-groups');
    const forgotPinBtn = document.getElementById('forgot-pin');
    const groupSearchInput = document.getElementById('group-search');
    const groupListEl = document.getElementById('group-list');
    const addWebhookBtn = document.getElementById('add-webhook');
    const webhookListEl = document.getElementById('webhook-list');
    const statusEl = document.getElementById('status');
    const saveBtn = document.getElementById('save');
    const saveFooterBtn = document.getElementById('save-footer');

    let knownGroups = [];
    let watchedIds = new Set();
    let groupKeywords = {};
    let groupsUnlocked = false;
    let hasGroupPin = false;
    let unlockedPin = '';
    let groupSearchTerm = '';
    let webhooks = [];

    function renderGroups() {
      if (!knownGroups.length) {
        groupListEl.innerHTML = '<div class="muted">No groups available yet. Run setup again to refresh group list.</div>';
        return;
      }

      const filtered = knownGroups.filter((group) =>
        String(group.name || group.id).toLowerCase().includes(groupSearchTerm.toLowerCase())
      );
      if (!filtered.length) {
        groupListEl.innerHTML = '<div class="muted">No groups matched your search.</div>';
        return;
      }

      groupListEl.innerHTML = filtered.map((group) => {
        const checked = watchedIds.has(group.id) ? 'checked' : '';
        const kw = (groupKeywords[group.id] || []).join(', ');
        return '<div class="group-row">'
          + '<input type="checkbox" data-group-id="' + escapeHtml(group.id) + '" ' + checked + '>'
          + '<span>' + escapeHtml(group.name || group.id) + '</span>'
          + '<input type="text" data-group-keywords="' + escapeHtml(group.id) + '" placeholder="keywords for this group" value="' + escapeHtml(kw) + '">'
          + '</div>';
      }).join('');
    }

    function escapeHtml(value) {
      const div = document.createElement('div');
      div.textContent = String(value || '');
      return div.innerHTML;
    }

    function renderWebhooks() {
      if (!webhooks.length) {
        webhookListEl.innerHTML = '<div class="empty-note">No webhooks configured. Add one to call an API when a watched message arrives.</div>';
        return;
      }

      webhookListEl.innerHTML = webhooks.map((rule, index) => {
        return '<div class="webhook-card" data-webhook-index="' + String(index) + '" data-webhook-id="' + escapeHtml(rule.id || '') + '">'
          + '<div class="webhook-card-header">'
          + '<div class="webhook-summary"><span class="icon" aria-hidden="true">&#8644;</span><strong data-webhook-summary-name>' + escapeHtml(rule.name || 'Webhook') + '</strong><span class="muted" data-webhook-summary-method>' + escapeHtml((rule.method || 'POST').toUpperCase()) + '</span></div>'
          + '<div class="row-inline">'
          + '<label class="switch"><input type="checkbox" data-webhook-enabled ' + (rule.enabled === false ? '' : 'checked') + '> Enabled</label>'
          + '<button class="danger" type="button" data-webhook-remove aria-label="Remove webhook"><span class="icon" aria-hidden="true">&#8722;</span> Remove</button>'
          + '</div>'
          + '</div>'
          + '<div class="webhook-grid">'
          + '<div class="field"><label class="field-label">Name</label><input data-webhook-name type="text" placeholder="Notify CRM" value="' + escapeHtml(rule.name || '') + '"></div>'
          + '<div class="field"><label class="field-label">Trigger</label><select data-webhook-trigger class="webhook-trigger">'
          + '<option value="all" ' + selected(rule.triggerType, 'all') + '>Every message</option>'
          + '<option value="sender" ' + selected(rule.triggerType, 'sender') + '>Every message from sender</option>'
          + '<option value="keyword" ' + selected(rule.triggerType, 'keyword') + '>Every message containing keyword</option>'
          + '</select></div>'
          + '<div class="field conditional" data-field-for="sender"><label class="field-label">Sender</label><input data-webhook-sender type="text" placeholder="Exact sender name" value="' + escapeHtml(rule.sender || '') + '"></div>'
          + '<div class="field conditional" data-field-for="keyword"><label class="field-label">Keyword</label><input data-webhook-keyword type="text" placeholder="urgent" value="' + escapeHtml(rule.keyword || '') + '"></div>'
          + '<label class="switch conditional" data-field-for="keywordRegex"><input type="checkbox" data-webhook-keyword-regex ' + (rule.keywordIsRegex ? 'checked' : '') + '> Keyword is regex</label>'
          + '<div class="field"><label class="field-label">Method</label><select data-webhook-method>'
          + methodOption(rule.method, 'POST') + methodOption(rule.method, 'GET') + methodOption(rule.method, 'PUT') + methodOption(rule.method, 'PATCH') + methodOption(rule.method, 'DELETE')
          + '</select></div>'
          + '<div class="field webhook-wide"><label class="field-label">URL</label><input data-webhook-url type="text" placeholder="https://example.com/hooks/{{groupName}}" value="' + escapeHtml(rule.url || '') + '"></div>'
          + '<label class="switch webhook-wide"><input type="checkbox" data-webhook-entire ' + (rule.sendEntireMessage ? 'checked' : '') + '> Send entire message as JSON body</label>'
          + '<div class="field webhook-wide conditional" data-field-for="body"><label class="field-label">Body template</label><textarea data-webhook-body placeholder="{&quot;text&quot;:&quot;{{text}}&quot;,&quot;sender&quot;:&quot;{{sender}}&quot;}">' + escapeHtml(rule.bodyTemplate || '') + '</textarea></div>'
          + '<div class="field webhook-wide"><label class="field-label">Regex extraction</label><input data-webhook-regex type="text" placeholder="order\\\\s+(?<orderId>\\\\d+)" value="' + escapeHtml(rule.regex || '') + '"></div>'
          + '<div class="field webhook-wide"><label class="field-label">Headers</label><textarea data-webhook-headers placeholder="Authorization: Bearer {{match1}}">' + escapeHtml(headersToText(rule.headers || {})) + '</textarea></div>'
          + '</div>'
          + '</div>';
      }).join('');
      document.querySelectorAll('.webhook-card').forEach(toggleWebhookFields);
    }

    function selected(value, expected) {
      return (value || 'all') === expected ? 'selected' : '';
    }

    function methodOption(value, expected) {
      return '<option value="' + expected + '" ' + (String(value || 'POST').toUpperCase() === expected ? 'selected' : '') + '>' + expected + '</option>';
    }

    function headersToText(headers) {
      return Object.entries(headers || {}).map(([key, value]) => key + ': ' + value).join('\\n');
    }

    function parseHeaders(value) {
      const out = {};
      String(value || '').split('\\n').forEach((line) => {
        const idx = line.indexOf(':');
        if (idx <= 0) return;
        const key = line.slice(0, idx).trim();
        if (!key) return;
        out[key] = line.slice(idx + 1).trim();
      });
      return out;
    }

    function serializeWebhooks() {
      return Array.from(document.querySelectorAll('.webhook-card')).map((card, index) => ({
        id: card.getAttribute('data-webhook-id') || 'webhook-' + String(index + 1),
        enabled: Boolean(card.querySelector('[data-webhook-enabled]').checked),
        name: card.querySelector('[data-webhook-name]').value.trim(),
        triggerType: card.querySelector('[data-webhook-trigger]').value,
        sender: card.querySelector('[data-webhook-sender]').value.trim(),
        keyword: card.querySelector('[data-webhook-keyword]').value.trim(),
        keywordIsRegex: Boolean(card.querySelector('[data-webhook-keyword-regex]').checked),
        method: card.querySelector('[data-webhook-method]').value,
        url: card.querySelector('[data-webhook-url]').value.trim(),
        regex: card.querySelector('[data-webhook-regex]').value.trim(),
        headers: parseHeaders(card.querySelector('[data-webhook-headers]').value),
        bodyTemplate: card.querySelector('[data-webhook-body]').value,
        sendEntireMessage: Boolean(card.querySelector('[data-webhook-entire]').checked),
      })).filter((rule) => rule.url);
    }

    function toggleWebhookFields(card) {
      const trigger = card.querySelector('[data-webhook-trigger]').value;
      const method = card.querySelector('[data-webhook-method]').value;
      const sendEntire = card.querySelector('[data-webhook-entire]').checked;
      setConditional(card, 'sender', trigger === 'sender');
      setConditional(card, 'keyword', trigger === 'keyword');
      setConditional(card, 'keywordRegex', trigger === 'keyword');
      setConditional(card, 'body', !sendEntire && method !== 'GET' && method !== 'DELETE');
    }

    function setConditional(card, name, visible) {
      card.querySelectorAll('[data-field-for="' + name + '"]').forEach((field) => {
        field.classList.toggle('hidden', !visible);
      });
    }

    async function loadState() {
      const state = await fetch('/api/state').then((r) => r.json());
      hasGroupPin = Boolean(state.hasGroupPin);
      pinNote.textContent = hasGroupPin
        ? 'PIN is set. Enter PIN to unlock group management.'
        : 'No PIN set yet. You can create one below.';
      groupsPanel.classList.add('hidden');
      groupsUnlocked = false;
      unlockedPin = '';

      showImagesInput.checked = state.showImages !== false;
      keywordToggle.checked = state.keywordMode === 'keywords';
      keywordsInput.value = (state.keywords || []).join(', ');
      pulseEnabledInput.checked = Boolean(state.pulseEnabled);
      pulseModeInput.value = state.pulseMode === 'keywords' ? 'keywords' : 'all';
      pulseKeywordsInput.value = (state.pulseKeywords || []).join(', ');
      fontSizeInput.value = Number(state.messageFontSize || 42);
      webhooks = Array.isArray(state.webhooks) ? state.webhooks : [];
      renderWebhooks();
      updatePulseUi();
    }

    async function unlockGroups() {
      const pin = groupsPinInput.value.trim();
      const res = await fetch('/api/groups/unlock', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pin }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        statusEl.textContent = body.error || 'PIN is incorrect.';
        return;
      }

      const data = await res.json();
      knownGroups = mergeGroups(data.knownGroups || [], data.watchedGroups || []);
      watchedIds = new Set((data.watchedGroups || []).map((group) => group.id));
      groupKeywords = data.groupKeywords || {};
      groupsUnlocked = true;
      unlockedPin = pin;
      groupsPanel.classList.remove('hidden');
      statusEl.textContent = 'Groups unlocked.';
      renderGroups();
    }

    unlockGroupsBtn.onclick = unlockGroups;

    refreshGroupsBtn.onclick = async () => {
      if (!groupsUnlocked) return;
      statusEl.textContent = 'Refreshing groups...';
      const res = await fetch('/api/groups/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pin: unlockedPin }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        statusEl.textContent = body.error || 'Could not refresh groups.';
        return;
      }
      knownGroups = mergeGroups(body.knownGroups || [], body.watchedGroups || []);
      watchedIds = new Set((body.watchedGroups || []).map((group) => group.id));
      statusEl.textContent = 'Groups refreshed.';
      renderGroups();
    };

    forgotPinBtn.onclick = async () => {
      statusEl.textContent = 'Logging out of WhatsApp and resetting PIN...';
      const res = await fetch('/api/groups/forgot-pin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        statusEl.textContent = body.error || 'Could not reset PIN.';
        return;
      }
      statusEl.textContent = 'PIN reset. Reconnect WhatsApp, then create a new PIN.';
      setTimeout(() => { location.href = '/onboarding'; }, 500);
    };

    groupSearchInput.addEventListener('input', () => {
      groupSearchTerm = groupSearchInput.value || '';
      if (groupsUnlocked) renderGroups();
    });

    groupListEl.addEventListener('input', (event) => {
      if (!groupsUnlocked) return;
      const target = event.target;
      if (!target || target.tagName !== 'INPUT') return;
      const groupId = target.getAttribute('data-group-keywords');
      if (!groupId) return;
      const words = String(target.value || '')
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
      groupKeywords[groupId] = words;
    });

    groupListEl.addEventListener('change', (event) => {
      if (!groupsUnlocked) return;
      const target = event.target;
      if (!target || target.type !== 'checkbox') return;
      const groupId = target.getAttribute('data-group-id');
      if (!groupId) return;
      if (target.checked) watchedIds.add(groupId);
      else watchedIds.delete(groupId);
    });

    addWebhookBtn.onclick = () => {
      webhooks = serializeWebhooks();
      webhooks.push({
        id: 'webhook-' + String(Date.now()),
        enabled: true,
        triggerType: 'all',
        method: 'POST',
        url: '',
        headers: {},
        bodyTemplate: '',
        sendEntireMessage: true,
      });
      renderWebhooks();
    };

    webhookListEl.addEventListener('click', (event) => {
      const target = event.target;
      if (!target || !target.hasAttribute('data-webhook-remove')) return;
      const card = target.closest('.webhook-card');
      if (!card) return;
      const index = Number(card.getAttribute('data-webhook-index'));
      webhooks = serializeWebhooks().filter((_rule, idx) => idx !== index);
      renderWebhooks();
    });

    webhookListEl.addEventListener('change', (event) => {
      const target = event.target;
      if (!target) return;
      const card = target.closest('.webhook-card');
      if (!card) return;
      if (
        target.hasAttribute('data-webhook-trigger') ||
        target.hasAttribute('data-webhook-method') ||
        target.hasAttribute('data-webhook-entire')
      ) {
        toggleWebhookFields(card);
      }
      updateWebhookSummary(card);
    });

    webhookListEl.addEventListener('input', (event) => {
      const target = event.target;
      if (!target || !target.hasAttribute('data-webhook-name')) return;
      const card = target.closest('.webhook-card');
      if (card) updateWebhookSummary(card);
    });

    function updateWebhookSummary(card) {
      const nameEl = card.querySelector('[data-webhook-summary-name]');
      const methodEl = card.querySelector('[data-webhook-summary-method]');
      if (nameEl) nameEl.textContent = card.querySelector('[data-webhook-name]').value.trim() || 'Webhook';
      if (methodEl) methodEl.textContent = card.querySelector('[data-webhook-method]').value;
    }

    function updatePulseUi() {
      const showPulseKeywords = pulseEnabledInput.checked && pulseModeInput.value === 'keywords';
      pulseKeywordsWrap.classList.toggle('hidden', !showPulseKeywords);
    }

    pulseEnabledInput.addEventListener('change', updatePulseUi);
    pulseModeInput.addEventListener('change', updatePulseUi);

    async function saveSettings() {
      const keywords = keywordsInput.value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
      const pulseKeywords = pulseKeywordsInput.value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
      const pinCurrent = pinCurrentInput.value.trim();
      const pinNew = pinNewInput.value.trim();
      const pinChanged = pinNew.length > 0;

      const payload = {
        showImages: showImagesInput.checked,
        keywordMode: keywordToggle.checked ? 'keywords' : 'all',
        keywords,
        pulseEnabled: pulseEnabledInput.checked,
        pulseMode: pulseModeInput.value === 'keywords' ? 'keywords' : 'all',
        pulseKeywords,
        messageFontSize: Number(fontSizeInput.value || 42),
        webhooks: serializeWebhooks(),
        groupPinCurrent: pinCurrent,
        groupPinNew: pinNew,
      };

      if (groupsUnlocked) {
        const watchedGroups = knownGroups.filter((group) => watchedIds.has(group.id));
        payload.knownGroups = knownGroups;
        payload.watchedGroups = watchedGroups;
        payload.groupKeywords = groupKeywords;
        payload.groupPinAuth = unlockedPin;
      }

      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        statusEl.textContent = body.error || 'Could not save settings.';
        return;
      }

      statusEl.textContent = 'Saved.';
      pinCurrentInput.value = '';
      pinNewInput.value = '';
      if (pinChanged) {
        groupsPanel.classList.add('hidden');
        groupsUnlocked = false;
        unlockedPin = '';
      }
      await loadState();
    }

    saveBtn.onclick = saveSettings;
    saveFooterBtn.onclick = saveSettings;

    loadState();

    function mergeGroups(a, b) {
      const byId = new Map();
      [a, b].forEach((list) => {
        (Array.isArray(list) ? list : []).forEach((group) => {
          const id = String(group && group.id || '').trim();
          if (!id) return;
          const name = String(group && group.name || '').trim();
          if (!byId.has(id)) byId.set(id, { id, name: name || id });
          else if (name && byId.get(id).name === id) byId.set(id, { id, name });
        });
      });
      return Array.from(byId.values()).sort((x, y) => x.name.localeCompare(y.name));
    }
  </script>
</body>
</html>`
}
