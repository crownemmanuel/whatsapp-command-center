import fs from "node:fs/promises"
import http from "node:http"
import path from "node:path"
import { WebSocketServer } from "ws"

const MEDIA_FILENAME_REG = /^[a-zA-Z0-9_.-]+\.(jpeg|jpg|png|gif|webp)$/

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
}) {
  const clients = new Set()

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`)

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      })
      res.end(renderDashboardHtml())
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
      res.end(renderOnboardingHtml())
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
        const contentType = ext === ".png" ? "image/png" : ext === ".gif" ? "image/gif" : ext === ".webp" ? "image/webp" : "image/jpeg"
        res.writeHead(200, { "Content-Type": contentType })
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
      <a class="btn" href="/settings">Settings</a>
      <button id="open-browser">Open Browser</button>
      <button id="stop-flash" class="danger">Stop Flash (S)</button>
      <button id="fullscreen">Fullscreen</button>
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
      window.open(location.href, '_blank', 'noopener');
    };

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

function renderOnboardingHtml() {
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
    button, a.btn, input[type="search"] {
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
        <h1>Scan WhatsApp QR</h1>
        <div class="muted">Use WhatsApp Linked devices, then choose which groups appear on the display.</div>
      </div>
      <div id="phase" class="status">Starting</div>
      <div class="qr-wrap">
        <img id="qr" alt="WhatsApp QR code" src="/api/setup/qr.png">
      </div>
      <div class="actions">
        <button id="rescan" class="danger" type="button">Logout and rescan</button>
        <a class="btn" href="/">Open display</a>
      </div>
      <div id="message"></div>
    </section>

    <section class="panel">
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
    const groupsEl = document.getElementById('groups');
    const groupCountEl = document.getElementById('group-count');
    const searchEl = document.getElementById('search');
    const refreshBtn = document.getElementById('refresh');
    const saveBtn = document.getElementById('save');
    const rescanBtn = document.getElementById('rescan');

    let knownGroups = [];
    let knownGroupSignature = '';
    let selectedIds = new Set();
    let qrWasAvailable = false;

    function setMessage(value) {
      messageEl.textContent = value || '';
    }

    function setPhase(value) {
      const label = String(value || 'starting').replaceAll('_', ' ');
      phaseEl.textContent = label.charAt(0).toUpperCase() + label.slice(1);
      phaseEl.classList.toggle('ready', value === 'ready' || value === 'connected');
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
      if (status.qrAvailable && !qrWasAvailable) {
        qrEl.src = '/api/setup/qr.png?ts=' + Date.now();
      }
      qrWasAvailable = Boolean(status.qrAvailable);

      const state = status.state || {};
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
      const res = await fetch('/api/groups/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
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
        body: JSON.stringify({ watchedGroups }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(body.error || 'Could not save groups.');
        return;
      }
      setMessage('Groups saved. Opening display...');
      setTimeout(() => { location.href = '/'; }, 400);
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
    refreshBtn.onclick = refreshGroups;
    saveBtn.onclick = saveGroups;
    rescanBtn.onclick = rescan;

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
    body {
      margin: 0;
      background: #0d0d0d;
      color: #f3f3f3;
      font-family: "Avenir Next", "Segoe UI", sans-serif;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 20px;
    }
    .card {
      width: min(820px, 100%);
      background: #171717;
      border: 1px solid #2f2f2f;
      border-radius: 14px;
      padding: 18px;
      display: grid;
      gap: 14px;
    }
    h1 { margin: 0; font-size: 1.4rem; }
    h2 { margin: 6px 0 0; font-size: 1.05rem; }
    .muted { color: #a3a3a3; }
    label { display: inline-flex; gap: 8px; align-items: center; }
    input[type="text"], input[type="number"], select {
      width: 100%;
      border-radius: 8px;
      border: 1px solid #3a3a3a;
      background: #111;
      color: #f3f3f3;
      padding: 10px;
      font-size: 1rem;
    }
    .group-list {
      display: grid;
      gap: 8px;
      max-height: 280px;
      overflow: auto;
      border: 1px solid #2f2f2f;
      border-radius: 8px;
      padding: 10px;
      background: #101010;
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
    .row-inline { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .hidden { display: none; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; }
    button, a {
      border-radius: 8px;
      border: 1px solid #3a3a3a;
      background: #1f1f1f;
      color: #f3f3f3;
      padding: 10px 12px;
      font-size: .95rem;
      text-decoration: none;
      cursor: pointer;
    }
    #status { color: #8cf3b2; min-height: 1.2em; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Display Settings</h1>
    <div class="muted">Choose what appears on the big screen.</div>

    <h2>Images</h2>
    <label><input id="show-images" type="checkbox" checked> Show images in messages (small thumbnail with download)</label>

    <h2>Message Filter</h2>
    <label><input id="keyword-toggle" type="checkbox"> Only show keyword matches</label>
    <input id="keywords" type="text" placeholder="keywords, comma, separated">
    <div class="muted">Example: urgent, dispatch, safety</div>

    <h2>Pulse Flash</h2>
    <label><input id="pulse-enabled" type="checkbox"> Enable red background pulse on new messages</label>
    <label for="pulse-mode">Pulse behavior</label>
    <select id="pulse-mode">
      <option value="all">Pulse on all shown messages</option>
      <option value="keywords">Pulse on keyword matches only</option>
    </select>
    <div id="pulse-keywords-wrap" class="hidden">
      <label for="pulse-keywords">Pulse keywords</label>
      <input id="pulse-keywords" type="text" placeholder="urgent, escalation, outage">
      <div class="muted">Used only for pulse behavior. Separate from message filter keywords.</div>
    </div>

    <h2>Font Size</h2>
    <label for="font-size">Message font size (px)</label>
    <input id="font-size" type="number" min="16" max="120" step="1">

    <h2>Groups</h2>
    <div class="muted">Protected by PIN. Unlock first to manage group visibility and group keywords.</div>
    <div id="pin-note" class="muted"></div>
    <div class="row-inline">
      <input id="groups-pin" type="password" inputmode="numeric" pattern="[0-9]*" placeholder="Enter PIN" style="max-width:220px;">
      <button id="unlock-groups" type="button">Unlock Groups</button>
    </div>
    <div class="row-inline">
      <input id="pin-current" type="password" inputmode="numeric" pattern="[0-9]*" placeholder="Current PIN (if set)" style="max-width:220px;">
      <input id="pin-new" type="password" inputmode="numeric" pattern="[0-9]*" placeholder="New PIN (4-8 digits)" style="max-width:220px;">
    </div>

    <div id="groups-panel" class="hidden">
      <input id="group-search" type="text" placeholder="Search groups by name">
      <div id="group-list" class="group-list"></div>
    </div>

    <div class="actions">
      <button id="save">Save</button>
      <a href="/">Back to Dashboard</a>
    </div>
    <div id="status"></div>
  </div>

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
    const groupSearchInput = document.getElementById('group-search');
    const groupListEl = document.getElementById('group-list');
    const statusEl = document.getElementById('status');
    const saveBtn = document.getElementById('save');

    let knownGroups = [];
    let watchedIds = new Set();
    let groupKeywords = {};
    let groupsUnlocked = false;
    let hasGroupPin = false;
    let unlockedPin = '';
    let groupSearchTerm = '';

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

    function updatePulseUi() {
      const showPulseKeywords = pulseEnabledInput.checked && pulseModeInput.value === 'keywords';
      pulseKeywordsWrap.classList.toggle('hidden', !showPulseKeywords);
    }

    pulseEnabledInput.addEventListener('change', updatePulseUi);
    pulseModeInput.addEventListener('change', updatePulseUi);

    saveBtn.onclick = async () => {
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
    };

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
