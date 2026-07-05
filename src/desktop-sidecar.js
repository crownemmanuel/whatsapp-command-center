import { startCommandCenter } from "./app-runtime.js"

function emit(event) {
  console.log(JSON.stringify(event))
}

try {
  const sidecarArgs = parseArgs(process.argv.slice(2))
  await startCommandCenter({
    args: sidecarArgs.passthrough,
    dataDir: sidecarArgs.dataDir,
    desktop: true,
    host: sidecarArgs.host,
    port: sidecarArgs.port,
    installSignalHandlers: true,
    openDashboard: false,
    onEvent: emit,
  })
} catch (error) {
  emit({
    type: "error",
    message: error instanceof Error ? error.message : String(error),
  })
  process.exit(1)
}

function parseArgs(args) {
  const out = {
    dataDir: "",
    host: "127.0.0.1",
    port: 0,
    passthrough: [],
  }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === "--data-dir") {
      out.dataDir = args[i + 1] || ""
      i += 1
    } else if (arg === "--host") {
      out.host = args[i + 1] || out.host
      i += 1
    } else if (arg === "--port") {
      out.port = Number(args[i + 1] || 0)
      i += 1
    } else {
      out.passthrough.push(arg)
    }
  }

  return out
}
