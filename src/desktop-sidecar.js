import { startCommandCenter } from "./app-runtime.js"

function emit(event) {
  console.log(JSON.stringify(event))
}

try {
  await startCommandCenter({
    args: process.argv.slice(2),
    desktop: true,
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
