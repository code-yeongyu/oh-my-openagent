import { describe, expect, it } from "bun:test"
import { startCallbackServer, type CallbackServer } from "./callback-server"

const HOSTNAME = "127.0.0.1"
const request = Bun.fetch.bind(Bun)

describe("startCallbackServer", () => {
  function close(server: CallbackServer): void {
    server.close()
  }

  it("starts server and returns port", async () => {
    const server = await startCallbackServer(0)

    try {
      expect(server.port).toBeGreaterThan(0)
      expect(typeof server.waitForCallback).toBe("function")
      expect(typeof server.close).toBe("function")
    } finally {
      close(server)
    }
  })

  it("resolves callback with code and state from query params", async () => {
    const server = await startCallbackServer(0)

    try {
      const callbackUrl = `http://${HOSTNAME}:${server.port}/oauth/callback?code=test-code&state=test-state`
      const [result, response] = await Promise.all([
        server.waitForCallback(),
        request(callbackUrl),
      ])

      expect(result).toEqual({ code: "test-code", state: "test-state" })
      expect(response.status).toBe(200)
      const html = await response.text()
      expect(html).toContain("Authorization successful")
    } finally {
      close(server)
    }
  })

  it("returns 404 for non-callback routes", async () => {
    const server = await startCallbackServer(0)

    try {
      const response = await request(`http://${HOSTNAME}:${server.port}/other`)

      expect(response.status).toBe(404)
    } finally {
      close(server)
    }
  })

  it("returns 400 and rejects when code is missing", async () => {
    const server = await startCallbackServer(0)

    try {
      const callbackRejection = server.waitForCallback().catch((error: Error) => error)
      const response = await request(`http://${HOSTNAME}:${server.port}/oauth/callback?state=s`)

      expect(response.status).toBe(400)
      const error = await callbackRejection
      expect(error).toBeInstanceOf(Error)
      if (!(error instanceof Error)) {
        throw new Error("Expected callback rejection to be an Error")
      }
      expect(error.message).toContain("missing code or state")
    } finally {
      close(server)
    }
  })

  it("returns 400 and rejects when state is missing", async () => {
    const server = await startCallbackServer(0)

    try {
      const callbackRejection = server.waitForCallback().catch((error: Error) => error)
      const response = await request(`http://${HOSTNAME}:${server.port}/oauth/callback?code=c`)

      expect(response.status).toBe(400)
      const error = await callbackRejection
      expect(error).toBeInstanceOf(Error)
      if (!(error instanceof Error)) {
        throw new Error("Expected callback rejection to be an Error")
      }
      expect(error.message).toContain("missing code or state")
    } finally {
      close(server)
    }
  })

  it("close stops the server immediately", async () => {
    const server = await startCallbackServer(0)
    const port = server.port

    server.close()

    try {
      await request(`http://${HOSTNAME}:${port}/oauth/callback?code=c&state=s`)
      expect.unreachable("request should fail after close")
    } catch (error) {
      expect(error).toBeDefined()
    }
  })
})
