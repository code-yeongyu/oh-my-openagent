import { join } from "node:path"
import { mkdir, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import type { BrowserAutomationConfig } from "../../../config/schema/browser-automation"

const STATE_DIR = join(homedir(), "Library", "Caches", "idm", "browser")
const PORT_FILE = join(STATE_DIR, "server.port")

async function findFreePort(start = 9876, end = 9976): Promise<number> {
  for (let p = start; p <= end; p++) {
    try {
      const srv = Bun.listen({
        port: p,
        hostname: "127.0.0.1",
        socket: { data() {} },
      })
      srv.stop(true)
      return p
    } catch {
      continue
    }
  }
  throw new Error(`No free port in ${start}-${end}`)
}

let serverHandle: { port: number; stop: () => Promise<void> } | null = null

export async function ensureLocalBrowserServer(config?: BrowserAutomationConfig): Promise<number> {
  if (serverHandle) return serverHandle.port

  await mkdir(STATE_DIR, { recursive: true })
  const port = await findFreePort()

  const { startBrowserServer } = await import("./server")
  const stop = await startBrowserServer(port, config)

  serverHandle = { port, stop }
  await writeFile(PORT_FILE, String(port), "utf8")

  return port
}

export async function shutdownLocalBrowserServer(): Promise<void> {
  if (!serverHandle) return
  await serverHandle.stop()
  serverHandle = null
}
