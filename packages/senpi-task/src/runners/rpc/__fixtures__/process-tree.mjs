import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

const SELF_PATH = fileURLToPath(import.meta.url)

if (process.argv[2] === "descendant") {
  process.on("SIGTERM", () => {})
  process.stdout.write("ready\n")
  setInterval(() => {}, 60_000)
} else {
  const descendant = spawn(process.execPath, [SELF_PATH, "descendant"], {
    stdio: "ignore",
  })
  if (descendant.pid === undefined) {
    throw new Error("process-tree descendant did not receive a pid")
  }
  process.stdout.write(`${descendant.pid}\n`)
  process.on("SIGTERM", () => {})
  setInterval(() => {}, 60_000)
}
