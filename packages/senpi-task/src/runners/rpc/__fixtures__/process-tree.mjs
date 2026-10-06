import { spawn } from "node:child_process"
import { once } from "node:events"
import { fileURLToPath } from "node:url"

const SELF_PATH = fileURLToPath(import.meta.url)
process.on("SIGTERM", () => {})

if (process.argv[2] === "descendant") {
  process.stdout.write("ready\n")
  setInterval(() => {}, 60_000)
} else {
  const descendant = spawn(process.execPath, [SELF_PATH, "descendant"], {
    stdio: ["ignore", "pipe", "ignore"],
  })
  if (descendant.pid === undefined) {
    throw new Error("process-tree descendant did not receive a pid")
  }
  // Announce the tree only after both processes can ignore SIGTERM.
  try {
    await once(descendant.stdout, "data", { signal: AbortSignal.timeout(2_000) })
  } catch (error) {
    descendant.kill("SIGKILL")
    throw error
  }
  process.stdout.write(`${descendant.pid}\n`)
  setInterval(() => {}, 60_000)
}
