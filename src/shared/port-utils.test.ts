import { describe, test, expect } from "bun:test"
import { createServer } from "node:net"

import {
  isPortAvailable,
  findAvailablePort,
  getAvailableServerPort,
  DEFAULT_SERVER_PORT,
} from "./port-utils"

describe("port-utils", () => {
  describe("#given DEFAULT_SERVER_PORT", () => {
    test("#then is 4096", () => {
      expect(DEFAULT_SERVER_PORT).toBe(4096)
    })
  })

  describe("#given isPortAvailable", () => {
    describe("#when port is free", () => {
      test("#then returns true", async () => {
        // Use a high port unlikely to be in use
        const result = await isPortAvailable(59123, "127.0.0.1")
        expect(result).toBe(true)
      })
    })

    describe("#when port is occupied", () => {
      test("#then returns false", async () => {
        const server = createServer()
        await new Promise<void>((resolve) => {
          server.listen(59124, "127.0.0.1", () => resolve())
        })
        try {
          const result = await isPortAvailable(59124, "127.0.0.1")
          expect(result).toBe(false)
        } finally {
          await new Promise<void>((resolve) => server.close(() => resolve()))
        }
      })
    })
  })

  describe("#given findAvailablePort", () => {
    describe("#when starting port is available", () => {
      test("#then returns the starting port", async () => {
        const port = await findAvailablePort(59130, "127.0.0.1")
        expect(port).toBe(59130)
      })
    })

    describe("#when starting port is occupied", () => {
      test("#then returns the next available port", async () => {
        const server = createServer()
        await new Promise<void>((resolve) => {
          server.listen(59140, "127.0.0.1", () => resolve())
        })
        try {
          const port = await findAvailablePort(59140, "127.0.0.1")
          expect(port).toBeGreaterThan(59140)
        } finally {
          await new Promise<void>((resolve) => server.close(() => resolve()))
        }
      })
    })
  })

  describe("#given getAvailableServerPort", () => {
    describe("#when preferred port is available", () => {
      test("#then returns preferred port with wasAutoSelected false", async () => {
        const result = await getAvailableServerPort(59150, "127.0.0.1")
        expect(result.port).toBe(59150)
        expect(result.wasAutoSelected).toBe(false)
      })
    })

    describe("#when preferred port is occupied", () => {
      test("#then returns different port with wasAutoSelected true", async () => {
        const server = createServer()
        await new Promise<void>((resolve) => {
          server.listen(59160, "127.0.0.1", () => resolve())
        })
        try {
          const result = await getAvailableServerPort(59160, "127.0.0.1")
          expect(result.port).toBeGreaterThan(59160)
          expect(result.wasAutoSelected).toBe(true)
        } finally {
          await new Promise<void>((resolve) => server.close(() => resolve()))
        }
      })
    })
  })
})
