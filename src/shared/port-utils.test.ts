import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import {
  isPortAvailable,
  findAvailablePort,
  getAvailableServerPort,
  DEFAULT_SERVER_PORT,
} from "./port-utils"

const HOSTNAME = "127.0.0.1"
const REAL_PORT_SEARCH_WINDOW = 200

function supportsRealSocketBinding(): boolean {
  try {
    const server = Bun.serve({
      port: 0,
      hostname: HOSTNAME,
      fetch: () => new Response("probe"),
    })
    server.stop(true)
    return true
  } catch {
    return false
  }
}

const canBindRealSockets = supportsRealSocketBinding()

describe("port-utils", () => {
  if (canBindRealSockets) {
    function startRealBlocker(port: number = 0) {
      return Bun.serve({
        port,
        hostname: HOSTNAME,
        fetch: () => new Response("blocked"),
      })
    }

    async function findContiguousAvailableStart(length: number): Promise<number> {
      const probe = startRealBlocker()
      const seedPort = probe.port
      probe.stop(true)

      for (let candidate = seedPort; candidate < seedPort + REAL_PORT_SEARCH_WINDOW; candidate++) {
        const checks = await Promise.all(
          Array.from({ length }, async (_, offset) => isPortAvailable(candidate + offset, HOSTNAME))
        )
        if (checks.every(Boolean)) {
          return candidate
        }
      }

      throw new Error(`Could not find ${length} contiguous available ports`)
    }

    describe("with real sockets", () => {
      describe("isPortAvailable", () => {
        it("#given unused port #when checking availability #then returns true", async () => {
          const blocker = startRealBlocker()
          const port = blocker.port
          blocker.stop(true)

          const result = await isPortAvailable(port)
          expect(result).toBe(true)
        })

        it("#given port in use #when checking availability #then returns false", async () => {
          const blocker = startRealBlocker()
          const port = blocker.port

          try {
            const result = await isPortAvailable(port)
            expect(result).toBe(false)
          } finally {
            blocker.stop(true)
          }
        })
      })

      describe("findAvailablePort", () => {
        it("#given start port available #when finding port #then returns start port", async () => {
          const startPort = await findContiguousAvailableStart(1)
          const result = await findAvailablePort(startPort)
          expect(result).toBe(startPort)
        })

        it("#given start port blocked #when finding port #then returns next available", async () => {
          const startPort = await findContiguousAvailableStart(2)
          const blocker = startRealBlocker(startPort)

          try {
            const result = await findAvailablePort(startPort)
            expect(result).toBe(startPort + 1)
          } finally {
            blocker.stop(true)
          }
        })

        it("#given multiple ports blocked #when finding port #then skips all blocked", async () => {
          const startPort = await findContiguousAvailableStart(4)
          const blockers = [
            startRealBlocker(startPort),
            startRealBlocker(startPort + 1),
            startRealBlocker(startPort + 2),
          ]

          try {
            const result = await findAvailablePort(startPort)
            expect(result).toBe(startPort + 3)
          } finally {
            blockers.forEach((blocker) => blocker.stop(true))
          }
        })
      })

      describe("getAvailableServerPort", () => {
        it("#given preferred port available #when getting port #then returns preferred with wasAutoSelected=false", async () => {
          const preferredPort = await findContiguousAvailableStart(1)
          const result = await getAvailableServerPort(preferredPort)
          expect(result.port).toBe(preferredPort)
          expect(result.wasAutoSelected).toBe(false)
        })

        it("#given preferred port blocked #when getting port #then returns alternative with wasAutoSelected=true", async () => {
          const preferredPort = await findContiguousAvailableStart(2)
          const blocker = startRealBlocker(preferredPort)

          try {
            const result = await getAvailableServerPort(preferredPort)
            expect(result.port).toBe(preferredPort + 1)
            expect(result.wasAutoSelected).toBe(true)
          } finally {
            blocker.stop(true)
          }
        })
      })
    })
  } else {
    const blockedSockets = new Set<string>()
    let serveSpy: ReturnType<typeof spyOn>

    function getSocketKey(port: number, hostname: string): string {
      return `${hostname}:${port}`
    }

    beforeEach(() => {
      blockedSockets.clear()
      serveSpy = spyOn(Bun, "serve").mockImplementation(({ port, hostname }) => {
        if (typeof port !== "number") {
          throw new Error("Test expected numeric port")
        }
        const resolvedHostname = typeof hostname === "string" ? hostname : HOSTNAME
        const socketKey = getSocketKey(port, resolvedHostname)

        if (blockedSockets.has(socketKey)) {
          const error = new Error(`Failed to start server. Is port ${port} in use?`) as Error & {
            code?: string
            syscall?: string
            errno?: number
            address?: string
            port?: number
          }
          error.code = "EADDRINUSE"
          error.syscall = "listen"
          error.errno = 0
          error.address = resolvedHostname
          error.port = port
          throw error
        }

        blockedSockets.add(socketKey)
        return {
          stop: (_force?: boolean) => {
            blockedSockets.delete(socketKey)
          },
        } as { stop: (force?: boolean) => void }
      })
    })

    afterEach(() => {
      expect(blockedSockets.size).toBe(0)
      serveSpy.mockRestore()
      blockedSockets.clear()
    })

    describe("with mocked sockets fallback", () => {
      describe("isPortAvailable", () => {
        it("#given unused port #when checking availability #then returns true", async () => {
          const port = 59999

          const result = await isPortAvailable(port)
          expect(result).toBe(true)
          expect(blockedSockets.size).toBe(0)
        })

        it("#given port in use #when checking availability #then returns false", async () => {
          const port = 59998
          const blocker = Bun.serve({
            port,
            hostname: HOSTNAME,
            fetch: () => new Response("blocked"),
          })

          try {
            const result = await isPortAvailable(port)
            expect(result).toBe(false)
          } finally {
            blocker.stop(true)
          }
        })

        it("#given custom hostname #when checking availability #then passes hostname through to Bun.serve", async () => {
          const hostname = "192.0.2.10"
          await isPortAvailable(59995, hostname)

          expect(serveSpy.mock.calls[0]?.[0]?.hostname).toBe(hostname)
        })
      })

      describe("findAvailablePort", () => {
        it("#given start port available #when finding port #then returns start port", async () => {
          const startPort = 59997
          const result = await findAvailablePort(startPort)
          expect(result).toBe(startPort)
        })

        it("#given start port blocked #when finding port #then returns next available", async () => {
          const startPort = 59996
          const blocker = Bun.serve({
            port: startPort,
            hostname: HOSTNAME,
            fetch: () => new Response("blocked"),
          })

          try {
            const result = await findAvailablePort(startPort)
            expect(result).toBe(startPort + 1)
          } finally {
            blocker.stop(true)
          }
        })

        it("#given multiple ports blocked #when finding port #then skips all blocked", async () => {
          const startPort = 59993
          const blockers = [
            Bun.serve({ port: startPort, hostname: HOSTNAME, fetch: () => new Response() }),
            Bun.serve({ port: startPort + 1, hostname: HOSTNAME, fetch: () => new Response() }),
            Bun.serve({ port: startPort + 2, hostname: HOSTNAME, fetch: () => new Response() }),
          ]

          try {
            const result = await findAvailablePort(startPort)
            expect(result).toBe(startPort + 3)
          } finally {
            blockers.forEach((blocker) => blocker.stop(true))
          }
        })
      })

      describe("getAvailableServerPort", () => {
        it("#given preferred port available #when getting port #then returns preferred with wasAutoSelected=false", async () => {
          const preferredPort = 59990
          const result = await getAvailableServerPort(preferredPort)
          expect(result.port).toBe(preferredPort)
          expect(result.wasAutoSelected).toBe(false)
        })

        it("#given preferred port blocked #when getting port #then returns alternative with wasAutoSelected=true", async () => {
          const preferredPort = 59989
          const blocker = Bun.serve({
            port: preferredPort,
            hostname: HOSTNAME,
            fetch: () => new Response("blocked"),
          })

          try {
            const result = await getAvailableServerPort(preferredPort)
            expect(result.port).toBe(preferredPort + 1)
            expect(result.wasAutoSelected).toBe(true)
          } finally {
            blocker.stop(true)
          }
        })
      })
    })
  }

  describe("DEFAULT_SERVER_PORT", () => {
    it("#given constant #when accessed #then returns 4096", () => {
      expect(DEFAULT_SERVER_PORT).toBe(4096)
    })
  })
})
