import { createServer } from "node:net"

const DEFAULT_SERVER_PORT = 4096
const MAX_PORT_ATTEMPTS = 20
const PORT_CHECK_TIMEOUT_MS = 2000

export async function isPortAvailable(port: number, hostname: string = "127.0.0.1"): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const server = createServer()
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    let resolved = false

    const finish = (isAvailable: boolean): void => {
      if (resolved) {
        return
      }
      resolved = true
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      server.removeAllListeners("error")
      server.removeAllListeners("listening")
      resolve(isAvailable)
    }

    const closeThenFinish = (isAvailable: boolean): void => {
      try {
        server.close(() => finish(isAvailable))
      } catch {
        finish(isAvailable)
      }
    }

    timeoutId = setTimeout(() => {
      closeThenFinish(false)
    }, PORT_CHECK_TIMEOUT_MS)

    server.once("error", () => {
      finish(false)
    })
    server.once("listening", () => {
      closeThenFinish(true)
    })

    try {
      server.listen(port, hostname)
    } catch {
      finish(false)
    }
  })
}

export async function findAvailablePort(
  startPort: number = DEFAULT_SERVER_PORT,
  hostname: string = "127.0.0.1"
): Promise<number> {
  for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt++) {
    const port = startPort + attempt
    if (await isPortAvailable(port, hostname)) {
      return port
    }
  }
  throw new Error(`No available port found in range ${startPort}-${startPort + MAX_PORT_ATTEMPTS - 1}`)
}

export interface AutoPortResult {
  port: number
  wasAutoSelected: boolean
}

export async function getAvailableServerPort(
  preferredPort: number = DEFAULT_SERVER_PORT,
  hostname: string = "127.0.0.1"
): Promise<AutoPortResult> {
  if (await isPortAvailable(preferredPort, hostname)) {
    return { port: preferredPort, wasAutoSelected: false }
  }

  const port = await findAvailablePort(preferredPort + 1, hostname)
  return { port, wasAutoSelected: true }
}

export { DEFAULT_SERVER_PORT }
