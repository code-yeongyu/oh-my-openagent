import { spawn } from "bun"
import { isInsideCmux, getCmuxSocketPath } from "./environment"

export async function isServerRunning(socketPath?: string): Promise<boolean> {
  if (!isInsideCmux()) {
    return false
  }

  const path = socketPath || getCmuxSocketPath()
  if (!path) {
    return false
  }

  try {
    const request = {
      id: `ping-${Date.now()}`,
      method: "system.ping",
      params: {},
    }

    const proc = spawn(
      ["cmux", "rpc", JSON.stringify(request)],
      {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, CMUX_SOCKET_PATH: path },
      }
    )

    const timeout = new Promise<boolean>((_, reject) =>
      setTimeout(() => reject(new Error("Timeout")), 5000)
    )

    const result = await Promise.race([
      proc.exited.then(async (code) => {
        if (code !== 0) return false
        const stdout = await new Response(proc.stdout).text()
        try {
          const response = JSON.parse(stdout.trim())
          return response.ok === true
        } catch {
          return false
        }
      }),
      timeout,
    ])

    return result
  } catch {
    return false
  }
}

let cachedServerStatus: boolean | null = null
let lastCheckTime = 0
const CACHE_TTL_MS = 5000

export async function isServerRunningCached(socketPath?: string): Promise<boolean> {
  const now = Date.now()
  if (cachedServerStatus !== null && (now - lastCheckTime) < CACHE_TTL_MS) {
    return cachedServerStatus
  }

  cachedServerStatus = await isServerRunning(socketPath)
  lastCheckTime = now
  return cachedServerStatus
}

export function resetServerCheck(): void {
  cachedServerStatus = null
  lastCheckTime = 0
}
