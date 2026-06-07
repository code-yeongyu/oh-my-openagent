/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { Buffer } from "node:buffer"
import { type IncomingMessage, request as httpRequest } from "node:http"
import { startCallbackServer, type CallbackServer } from "./callback-server"

const HOSTNAME = "127.0.0.1"

function request(url: string): Promise<Response> {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const req = httpRequest(
      {
        hostname: target.hostname,
        port: Number.parseInt(target.port, 10),
        path: `${target.pathname}${target.search}`,
        method: "GET",
      },
      (res: IncomingMessage) => {
        const chunks: Buffer[] = []
        const headers = new Headers()

        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk)
        })
        res.on("end", () => {
          for (const [name, value] of Object.entries(res.headers)) {
            if (typeof value === "string") {
              headers.set(name, value)
              continue
            }
            if (Array.isArray(value)) {
              for (const item of value) {
                headers.append(name, item)
              }
            }
          }

          resolve(
            new Response(Buffer.concat(chunks), {
              status: res.statusCode ?? 0,
              headers,
            }),
          )
        })
      },
    )

    req.on("error", reject)
    req.end()
  })
}

describe("startCallbackServer", () => {
  async function close(server: CallbackServer): Promise<void> {
    await server.close()
  }

  it("starts server and returns port", async () => {
    const server = await startCallbackServer(0)

    try {
      expect(server.port).toBeGreaterThan(0)
      expect(typeof server.waitForCallback).toBe("function")
      expect(typeof server.close).toBe("function")
    } finally {
      await close(server)
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
      await close(server)
    }
  })

  it("returns 404 for non-callback routes", async () => {
    const server = await startCallbackServer(0)

    try {
      const response = await request(`http://${HOSTNAME}:${server.port}/other`)

      expect(response.status).toBe(404)
    } finally {
      await close(server)
    }
  })

  it("keeps startup probes on the non-callback route contract", async () => {
    const server = await startCallbackServer(0)

    try {
      const readyResponse = await request(`http://${HOSTNAME}:${server.port}/__omo_oauth_startup_probe__`)
      expect(readyResponse.status).toBe(404)

      const callbackUrl = `http://${HOSTNAME}:${server.port}/oauth/callback?code=after-ready&state=still-waiting`
      const [result, response] = await Promise.all([
        server.waitForCallback(),
        request(callbackUrl),
      ])

      expect(result).toEqual({ code: "after-ready", state: "still-waiting" })
      expect(response.status).toBe(200)
    } finally {
      await close(server)
    }
  })

  it("uses native timers for server lifetime when global timers are patched", async () => {
    const originalSetTimeout = globalThis.setTimeout
    const originalClearTimeout = globalThis.clearTimeout
    globalThis.setTimeout = ((handler, timeout, ...args) => {
      const timer = originalSetTimeout(handler, timeout, ...args)
      if (typeof timeout === "number" && timeout >= 60_000 && typeof handler === "function") {
        queueMicrotask(() => handler(...args))
      }
      return timer
    }) as typeof globalThis.setTimeout
    globalThis.clearTimeout = ((timer) => {
      originalClearTimeout(timer)
    }) as typeof globalThis.clearTimeout

    let server: CallbackServer | undefined

    try {
      server = await startCallbackServer(0)
      globalThis.setTimeout = originalSetTimeout
      globalThis.clearTimeout = originalClearTimeout

      const callbackUrl = `http://${HOSTNAME}:${server.port}/oauth/callback?code=native-code&state=native-state`
      const [result, response] = await Promise.all([
        server.waitForCallback(),
        request(callbackUrl),
      ])

      expect(result).toEqual({ code: "native-code", state: "native-state" })
      expect(response.status).toBe(200)
    } finally {
      if (server) {
        await close(server)
      }
      globalThis.setTimeout = originalSetTimeout
      globalThis.clearTimeout = originalClearTimeout
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
      await close(server)
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
      await close(server)
    }
  })

  it("close stops the server immediately", async () => {
    const server = await startCallbackServer(0)
    const port = server.port

    await server.close()

    try {
      await request(`http://${HOSTNAME}:${port}/oauth/callback?code=c&state=s`)
      expect.unreachable("request should fail after close")
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      if (!(error instanceof Error)) {
        throw new Error("Expected request after close to fail with an Error")
      }
    }
  })

  it("close resolves after the underlying server releases its port", async () => {
    const firstServer = await startCallbackServer(0)
    const port = firstServer.port

    const closeResult = firstServer.close()
    expect(closeResult).toBeInstanceOf(Promise)
    await closeResult

    const secondServer = await startCallbackServer(port)
    try {
      expect(secondServer.port).toBe(port)
      const response = await request(`http://${HOSTNAME}:${port}/other`)
      expect(response.status).toBe(404)
    } finally {
      await close(secondServer)
    }
  })
})
