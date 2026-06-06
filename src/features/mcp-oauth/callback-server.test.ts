import { describe, expect, it } from "bun:test"
import { request as httpRequest } from "node:http"
import { startCallbackServer, type CallbackServer } from "./callback-server"

const HOSTNAME = "127.0.0.1"
const BASE_TEST_PORT = 19877

describe("startCallbackServer", () => {
  function request(url: string): Promise<Response> {
    return new Promise<Response>((resolve, reject) => {
      const req = httpRequest(url, (res) => {
        const chunks: Uint8Array[] = []
        res.on("data", (chunk: Buffer | string) => {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
        })
        res.on("end", () => {
          const headers = new Headers()
          for (const [key, value] of Object.entries(res.headers)) {
            if (Array.isArray(value)) {
              for (const item of value) headers.append(key, item)
            } else if (value !== undefined) {
              headers.set(key, String(value))
            }
          }

          resolve(new Response(Buffer.concat(chunks), {
            headers,
            status: res.statusCode ?? 500,
          }))
        })
      })
      req.on("error", reject)
      req.end()
    })
  }

  function close(server: CallbackServer): void {
    server.close()
  }

  it("starts server and returns port", async () => {
    const server = await startCallbackServer(BASE_TEST_PORT)

    try {
      expect(server.port).toBeGreaterThanOrEqual(BASE_TEST_PORT)
      expect(typeof server.waitForCallback).toBe("function")
      expect(typeof server.close).toBe("function")
    } finally {
      close(server)
    }
  })

  it("resolves callback with code and state from query params", async () => {
    const server = await startCallbackServer(BASE_TEST_PORT + 10)

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
    const server = await startCallbackServer(BASE_TEST_PORT + 20)

    try {
      const response = await request(`http://${HOSTNAME}:${server.port}/other`)

      expect(response.status).toBe(404)
    } finally {
      close(server)
    }
  })

  it("returns 400 and rejects when code is missing", async () => {
    const server = await startCallbackServer(BASE_TEST_PORT + 30)

    try {
      const callbackRejection = server.waitForCallback().catch((error: Error) => error)
      const response = await request(`http://${HOSTNAME}:${server.port}/oauth/callback?state=s`)

      expect(response.status).toBe(400)
      const error = await callbackRejection
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toContain("missing code or state")
    } finally {
      close(server)
    }
  })

  it("returns 400 and rejects when state is missing", async () => {
    const server = await startCallbackServer(BASE_TEST_PORT + 40)

    try {
      const callbackRejection = server.waitForCallback().catch((error: Error) => error)
      const response = await request(`http://${HOSTNAME}:${server.port}/oauth/callback?code=c`)

      expect(response.status).toBe(400)
      const error = await callbackRejection
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toContain("missing code or state")
    } finally {
      close(server)
    }
  })

  it("close stops the server immediately", async () => {
    const server = await startCallbackServer(BASE_TEST_PORT + 50)
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
