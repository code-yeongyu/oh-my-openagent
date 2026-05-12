import { createServer, Server } from "node:net"
import type { AddressInfo } from "node:net"
import { networkInterfaces } from "node:os"

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"

import { DEFAULT_SERVER_PORT, findAvailablePort, getAvailableServerPort, isPortAvailable } from "./port-utils"

const DEFAULT_HOSTNAME = "127.0.0.1"
const MAX_PORT_ATTEMPTS = 20
const EXHAUSTED_PORT_COUNT = MAX_PORT_ATTEMPTS + 1
const CONTIGUOUS_SEARCH_WINDOW = 256
const CONTIGUOUS_SEARCH_SEEDS = 8

const trackedServers = new Set<Server>()

type TimeoutProbeResult = {
  closeCallCount: number
  isAvailable: boolean
  server: Server | undefined
}

function getRequiredPropertyDescriptor(target: object, propertyName: string): PropertyDescriptor {
  const descriptor = Object.getOwnPropertyDescriptor(target, propertyName)
  if (!descriptor) {
    throw new Error(`Expected ${propertyName} property descriptor`)
  }

  return descriptor
}

function isTcpAddress(address: ReturnType<Server["address"]>): address is AddressInfo {
  return typeof address === "object" && address !== null && "port" in address
}

function getServerPort(server: Server): number {
  const address = server.address()
  if (!isTcpAddress(address)) {
    throw new Error("Expected TCP server address")
  }

  return address.port
}

function getAlternateIpv4Hostname(): string | undefined {
  for (const addresses of Object.values(networkInterfaces())) {
    if (!addresses) continue

    for (const address of addresses) {
      if (address.family === "IPv4" && !address.internal && address.address !== DEFAULT_HOSTNAME) {
        return address.address
      }
    }
  }

  return undefined
}

function startTrackedServer(port: number, hostname: string = DEFAULT_HOSTNAME): Promise<Server> {
  return new Promise<Server>((resolve, reject) => {
    const server = createServer()

    const removeListeners = (): void => {
      server.removeListener("error", handleError)
      server.removeListener("listening", handleListening)
    }

    const handleError = (error: Error): void => {
      removeListeners()
      trackedServers.delete(server)
      reject(error)
    }

    const handleListening = (): void => {
      removeListeners()
      trackedServers.add(server)
      resolve(server)
    }

    server.once("error", handleError)
    server.once("listening", handleListening)

    try {
      server.listen(port, hostname)
    } catch (error) {
      removeListeners()
      trackedServers.delete(server)
      reject(error)
    }
  })
}

function closeTrackedServer(server: Server): Promise<void> {
  trackedServers.delete(server)

  if (!server.listening) {
    return Promise.resolve()
  }

  return new Promise<void>((resolve, reject) => {
    server.close((error?: Error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

async function closeAllTrackedServers(): Promise<void> {
  await Promise.all(Array.from(trackedServers).map((server) => closeTrackedServer(server)))
}

async function getReleasedPort(hostname: string = DEFAULT_HOSTNAME): Promise<number> {
  const server = await startTrackedServer(0, hostname)
  const port = getServerPort(server)
  await closeTrackedServer(server)

  return port
}

async function canBindContiguousPorts(
  startPort: number,
  portCount: number,
  hostname: string = DEFAULT_HOSTNAME
): Promise<boolean> {
  const servers: Server[] = []

  try {
    for (let offset = 0; offset < portCount; offset++) {
      servers.push(await startTrackedServer(startPort + offset, hostname))
    }

    return true
  } catch {
    return false
  } finally {
    await Promise.all(servers.map((server) => closeTrackedServer(server)))
  }
}

async function findContiguousAvailableStart(
  portCount: number,
  hostname: string = DEFAULT_HOSTNAME
): Promise<number> {
  for (let seedAttempt = 0; seedAttempt < CONTIGUOUS_SEARCH_SEEDS; seedAttempt++) {
    const seedPort = await getReleasedPort(hostname)
    const maxStartPort = Math.min(65_535 - portCount + 1, seedPort + CONTIGUOUS_SEARCH_WINDOW)

    for (let candidatePort = seedPort; candidatePort <= maxStartPort; candidatePort++) {
      if (await canBindContiguousPorts(candidatePort, portCount, hostname)) {
        return candidatePort
      }
    }
  }

  throw new Error(`Could not find ${portCount} contiguous available ports`)
}

async function startConsecutiveBlockers(
  startPort: number,
  portCount: number,
  hostname: string = DEFAULT_HOSTNAME
): Promise<Server[]> {
  const servers: Server[] = []

  try {
    for (let offset = 0; offset < portCount; offset++) {
      servers.push(await startTrackedServer(startPort + offset, hostname))
    }

    return servers
  } catch (error) {
    await Promise.all(servers.map((server) => closeTrackedServer(server)))
    throw error
  }
}

async function captureDefaultListenHostname(port: number): Promise<string | undefined> {
  const listenDescriptor = getRequiredPropertyDescriptor(Server.prototype, "listen")
  const closeDescriptor = getRequiredPropertyDescriptor(Server.prototype, "close")
  let capturedHostname: string | undefined

  Object.defineProperty(Server.prototype, "listen", {
    configurable: true,
    value: function listenAndCaptureHostname(this: Server, requestedPort: number, hostname?: string): Server {
      if (requestedPort === port) {
        capturedHostname = hostname
      }
      queueMicrotask(() => this.emit("listening"))
      return this
    },
  })
  Object.defineProperty(Server.prototype, "close", {
    configurable: true,
    value: function closeCapturedServer(this: Server, callback?: (error?: Error) => void): Server {
      queueMicrotask(() => callback?.())
      return this
    },
  })

  try {
    await isPortAvailable(port)
    return capturedHostname
  } finally {
    Object.defineProperty(Server.prototype, "listen", listenDescriptor)
    Object.defineProperty(Server.prototype, "close", closeDescriptor)
  }
}

async function runTimedOutAvailabilityProbe(port: number): Promise<TimeoutProbeResult> {
  const setTimeoutDescriptor = getRequiredPropertyDescriptor(globalThis, "setTimeout")
  const listenDescriptor = getRequiredPropertyDescriptor(Server.prototype, "listen")
  const closeDescriptor = getRequiredPropertyDescriptor(Server.prototype, "close")
  const originalSetTimeout = globalThis.setTimeout
  let timedOutServer: Server | undefined
  let closeCallCount = 0

  Object.defineProperty(globalThis, "setTimeout", {
    configurable: true,
    value: (callback: () => void): ReturnType<typeof setTimeout> => originalSetTimeout(callback, 0),
  })
  Object.defineProperty(Server.prototype, "listen", {
    configurable: true,
    value: function listenWithoutEmitting(this: Server): Server {
      timedOutServer = this
      return this
    },
  })
  Object.defineProperty(Server.prototype, "close", {
    configurable: true,
    value: function closeTimedOutServer(this: Server, callback?: (error?: Error) => void): Server {
      closeCallCount++
      queueMicrotask(() => callback?.())
      return this
    },
  })

  try {
    const isAvailable = await isPortAvailable(port)
    return { closeCallCount, isAvailable, server: timedOutServer }
  } finally {
    Object.defineProperty(globalThis, "setTimeout", setTimeoutDescriptor)
    Object.defineProperty(Server.prototype, "listen", listenDescriptor)
    Object.defineProperty(Server.prototype, "close", closeDescriptor)
  }
}

describe("port-utils", () => {
  beforeAll(() => {
    trackedServers.clear()
  })

  afterEach(async () => {
    await closeAllTrackedServers()
  })

  afterAll(async () => {
    await closeAllTrackedServers()
  })

  describe("#given isPortAvailable", () => {
    test("#when a released port is checked #then returns true", async () => {
      const port = await getReleasedPort()

      const result = await isPortAvailable(port)

      expect(result).toBe(true)
    })

    test("#when an already bound port is checked #then returns false", async () => {
      const blocker = await startTrackedServer(0)
      const port = getServerPort(blocker)

      const result = await isPortAvailable(port)

      expect(result).toBe(false)
    })

    test("#when a timed out probe is cleaned up #then no listeners or server remain active", async () => {
      const port = await getReleasedPort()

      const result = await runTimedOutAvailabilityProbe(port)

      expect(result.isAvailable).toBe(false)
      expect(result.closeCallCount).toBe(1)
      expect(result.server).toBeDefined()
      if (!result.server) {
        throw new Error("Expected timed out server")
      }
      expect(result.server.listening).toBe(false)
      expect(result.server.listenerCount("error")).toBe(0)
      expect(result.server.listenerCount("listening")).toBe(0)
    })

    test("#when a successful probe finishes #then the port can be rebound immediately", async () => {
      const port = await getReleasedPort()

      const result = await isPortAvailable(port)
      const server = await startTrackedServer(port)

      expect(result).toBe(true)
      expect(getServerPort(server)).toBe(port)
    })

    test("#when hostname is omitted #then 127.0.0.1 is the default target", async () => {
      const blocker = await startTrackedServer(0, DEFAULT_HOSTNAME)
      const port = getServerPort(blocker)

      const result = await isPortAvailable(port)

      expect(result).toBe(false)
    })

    test("#when another interface owns the port #then default probing does not bind all interfaces", async () => {
      const alternateHostname = getAlternateIpv4Hostname()

      if (!alternateHostname) {
        const port = await getReleasedPort()
        const capturedHostname = await captureDefaultListenHostname(port)
        expect(capturedHostname).toBe(DEFAULT_HOSTNAME)
        return
      }

      const blocker = await startTrackedServer(0, alternateHostname)
      const port = getServerPort(blocker)

      expect(await isPortAvailable(port)).toBe(true)
      expect(await isPortAvailable(port, alternateHostname)).toBe(false)
    })
  })

  describe("#given findAvailablePort", () => {
    test("#when the start port is available #then returns the start port", async () => {
      const startPort = await findContiguousAvailableStart(1)

      const result = await findAvailablePort(startPort)

      expect(result).toBe(startPort)
    })

    test("#when the first three ports are blocked #then returns the next free port", async () => {
      const startPort = await findContiguousAvailableStart(4)
      await startConsecutiveBlockers(startPort, 3)

      const result = await findAvailablePort(startPort)

      expect(result).toBe(startPort + 3)
    })

    test("#when every attempted port is blocked #then throws", async () => {
      const startPort = await findContiguousAvailableStart(EXHAUSTED_PORT_COUNT)
      await startConsecutiveBlockers(startPort, EXHAUSTED_PORT_COUNT)

      let errorMessage: string | undefined
      try {
        await findAvailablePort(startPort)
      } catch (error) {
        if (!(error instanceof Error)) {
          throw error
        }
        errorMessage = error.message
      }

      expect(errorMessage).toBe(`No available port found in range ${startPort}-${startPort + MAX_PORT_ATTEMPTS - 1}`)
    })
  })

  describe("#given getAvailableServerPort", () => {
    test("#when the preferred port is free #then returns the preferred port without auto-selection", async () => {
      const preferredPort = await findContiguousAvailableStart(1)

      const result = await getAvailableServerPort(preferredPort)

      expect(result).toEqual({ port: preferredPort, wasAutoSelected: false })
    })

    test("#when the preferred port is blocked #then returns the next port with auto-selection", async () => {
      const preferredPort = await findContiguousAvailableStart(2)
      await startTrackedServer(preferredPort)

      const result = await getAvailableServerPort(preferredPort)
      expect(result).toEqual({ port: preferredPort + 1, wasAutoSelected: true })
    })
  })

  describe("#given DEFAULT_SERVER_PORT", () => {
    test("#when accessed #then returns 4096", () => {
      expect(DEFAULT_SERVER_PORT).toBe(4096)
    })
  })
})
