import { readFile, writeFile } from "node:fs/promises"
import { createConnection } from "node:net"
import { join } from "node:path"

const [mode, runDir] = process.argv.slice(2)
if (mode === undefined || runDir === undefined) throw new Error("mode and runDir are required")

const writeMarker = async (name: string, value: unknown): Promise<void> => {
  await writeFile(join(runDir, name), `${JSON.stringify(value)}\n`, "utf8")
}

if (mode === "inspect") {
  const ledger = JSON.parse(await readFile(join(runDir, "ledger.json"), "utf8")) as Record<string, unknown>
  await writeMarker("child-observation.json", {
    pid: ledger.pid,
    processStart: ledger.processStart,
    childPid: ledger.childPid,
    childProcessStart: ledger.childProcessStart,
  })
  process.exit(23)
}

if (mode === "model-not-found") {
  console.error('Error: Model "extension-only/primary" not found. Use --list-models to see available models.')
  process.exit(1)
} else if (mode === "graceful") {
  let terminating = false
  process.on("SIGTERM", () => {
    if (terminating) return
    terminating = true
    void writeMarker("child-terminated.json", { signal: "SIGTERM" }).then(() => process.exit(0))
  })
} else if (mode === "stubborn") {
  process.on("SIGTERM", () => {
    void writeMarker("child-terminated.json", { signal: "SIGTERM" })
  })
}

const exitPort = Number(process.env.OMO_MEMORY_SUPERVISOR_EXIT_PORT)
if (Number.isInteger(exitPort)) {
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port: exitPort }, resolve)
    socket.once("error", reject)
  })
}
await writeMarker("child-started.json", { pid: process.pid })
setInterval(() => undefined, 60_000)
