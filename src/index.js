import pino from "pino"
import { startCommandCenter } from "./app-runtime.js"

const LOG = pino({ name: "whatsapp-command-center", level: process.env.LOG_LEVEL || "info" })

try {
  const app = await startCommandCenter({
    args: process.argv.slice(2),
    desktop: false,
    installSignalHandlers: true,
  })

  if (typeof app.exitCode === "number") {
    process.exit(app.exitCode)
  }
} catch (error) {
  LOG.error({ err: error }, "Uncaught exception")
  console.error(`Startup failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
