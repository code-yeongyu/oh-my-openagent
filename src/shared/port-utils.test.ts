import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import {
  isPortAvailable,
  findAvailablePort,
  getAvailableServerPort,
  DEFAULT_SERVER_PORT,
} from "./port-utils"

describe("port-utils", () => {
  describe("isPortAvailable", () => {
    it("#given unused port #when checking availability #then returns true", async () => {
      const port = 59999
      const result = await isPortAvailable(port)
      expect(result).toBe(true)
    })

    it("#given port in use #when checking availability #then returns false", async () => {
      const port = 59998
      const blocker = Bun.serve({
        port,
        hostname: "127.0.0.1",
        fetch: () => new Response("blocked"),
      })

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
      const startPort = 59997
      const result = await findAvailablePort(startPort)
      expect(result).toBe(startPort)
    })

    it("#given start port blocked #when finding port #then returns next available", async () => {
      const startPort = 59996
      const blocker = Bun.serve({
        port: startPort,
        hostname: "127.0.0.1",
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
        Bun.serve({ port: startPort, hostname: "127.0.0.1", fetch: () => new Response() }),
        Bun.serve({ port: startPort + 1, hostname: "127.0.0.1", fetch: () => new Response() }),
        Bun.serve({ port: startPort + 2, hostname: "127.0.0.1", fetch: () => new Response() }),
      ]

      try {
        const result = await findAvailablePort(startPort)
        expect(result).toBe(startPort + 3)
      } finally {
        blockers.forEach((b) => b.stop(true))
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
        hostname: "127.0.0.1",
        fetch: () => new Response("blocked"),
      })

      try {
        const result = await getAvailableServerPort(preferredPort)
        expect(result.port).toBeGreaterThan(preferredPort)
        expect(result.wasAutoSelected).toBe(true)
      } finally {
        blocker.stop(true)
      }
    })
  })

  describe("DEFAULT_SERVER_PORT", () => {
    it("#given constant #when accessed #then returns 4096", () => {
      expect(DEFAULT_SERVER_PORT).toBe(4096)
    })
  })
})
