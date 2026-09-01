/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { Buffer } from "node:buffer"
import { createConnection } from "node:net"
import { startCallbackServer, type CallbackServer, type CallbackServerTimer, type CallbackServerTimerHandle } from "./callback-server"

const HOSTNAME = "127.0.0.1"
const CALLBACK_SERVER_TEST_TIMEOUT_MS = process.platform === "win32" ? 15_000 : 5_000

type ScheduledCallback = {
  readonly callback: () => void
  readonly delayMs: number
}

function createControllableTimer(): {
  readonly runTimersAtOrAfter: (minimumDelayMs: number) => void
  readonly timer: CallbackServerTimer
} {
  const scheduled = new Map<CallbackServerTimerHandle, ScheduledCallback>()

  return {
    runTimersAtOrAfter: (minimumDelayMs) => {
      for (const [handle, scheduledCallback] of Array.from(scheduled.entries())) {
        if (scheduledCallback.delayMs < minimumDelayMs) {
          continue
        }
        scheduled.delete(handle)
        scheduledCallback.callback()
      }
    },
    timer: {
      setTimeout: (callback, delayMs) => {
        const handle = globalThis.setTimeout(() => undefined, delayMs)
        globalThis.clearTimeout(handle)
        scheduled.set(handle, { callback, delayMs })
        return handle
      },
      clearTimeout: (handle) => {
        scheduled.delete(handle)
        globalThis.clearTimeout(handle)
      },
    },
  }
}

function request(url: string): Promise<Response> {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const port = Number.parseInt(target.port, 10)
    const chunks: Buffer[] = []
    let settled = false

    const finishWithError = (error: Error): void => {
      if (settled) {
        return
      }
      settled = true
      socket.destroy()
      reject(error)
    }

    const finishWithResponse = (): void => {
      if (settled) {
        return
      }
      settled = true

      const rawResponse = Buffer.concat(chunks)
      const headerEnd = rawResponse.indexOf("\r\n\r\n")
      if (headerEnd < 0) {
        reject(new Error("HTTP response did not include headers"))
        return
      }

      const headerText = rawResponse.subarray(0, headerEnd).toString("utf8")
      const [statusLine, ...headerLines] = headerText.split("\r\n")
      const status = Number.parseInt(statusLine?.split(" ")[1] ?? "", 10)
      if (!Number.isFinite(status)) {
        reject(new Error(`HTTP response had invalid status line: ${statusLine ?? ""}`))
        return
      }

      const headers = new Headers()
      for (const headerLine of headerLines) {
        const separatorIndex = headerLine.indexOf(":")
        if (separatorIndex < 0) {
          continue
        }
        const name = headerLine.slice(0, separatorIndex).trim()
        const value = headerLine.slice(separatorIndex + 1).trim()
        headers.append(name, value)
      }

      resolve(
        new Response(rawResponse.subarray(headerEnd + 4), {
          status,
          headers,
        }),
      )
    }

    const socket = createConnection({ host: target.hostname, port }, () => {
      socket.write(
        `GET ${target.pathname}${target.search} HTTP/1.1\r\nHost: ${target.host}\r\nConnection: close\r\n\r\n`,
      )
    })

    socket.on("data", (chunk: Buffer) => {
      chunks.push(chunk)
    })
    socket.once("end", finishWithResponse)
    socket.once("close", () => {
      if (settled) {
        return
      }
      if (chunks.length > 0) {
        finishWithResponse()
        return
      }
      finishWithError(new Error(`HTTP connection closed before response for ${url}`))
    })
    socket.once("error", finishWithError)
    socket.setTimeout(1_000, () => {
      finishWithError(new Error(`HTTP request timed out for ${url}`))
    })
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
  }, CALLBACK_SERVER_TEST_TIMEOUT_MS)

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
  }, CALLBACK_SERVER_TEST_TIMEOUT_MS)

  it("returns 404 for non-callback routes", async () => {
    const server = await startCallbackServer(0)

    try {
      const response = await request(`http://${HOSTNAME}:${server.port}/other`)

      expect(response.status).toBe(404)
    } finally {
      await close(server)
    }
  }, CALLBACK_SERVER_TEST_TIMEOUT_MS)

  it("keeps non-callback routes separate from OAuth callbacks", async () => {
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
  }, CALLBACK_SERVER_TEST_TIMEOUT_MS)

  it("#given injected callback timer #when OAuth lifetime expires #then callback rejects without global timer patches", async () => {
    const { runTimersAtOrAfter, timer } = createControllableTimer()
    const server = await startCallbackServer(0, { timer })

    try {
      const callbackRejection = server.waitForCallback().catch((error: Error) => error)

      runTimersAtOrAfter(60_000)

      const error = await callbackRejection
      expect(error).toBeInstanceOf(Error)
      if (!(error instanceof Error)) {
        throw new Error("Expected callback timeout to reject with an Error")
      }
      expect(error.message).toContain("timed out")
    } finally {
      await close(server)
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
  }, CALLBACK_SERVER_TEST_TIMEOUT_MS)

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
  }, CALLBACK_SERVER_TEST_TIMEOUT_MS)

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
  }, CALLBACK_SERVER_TEST_TIMEOUT_MS)

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
  }, CALLBACK_SERVER_TEST_TIMEOUT_MS)

  it("#given default callback port is occupied #when starting callback server #then it binds a fallback port", async () => {
    const occupiedDefaultPort = await startCallbackServer(19877)

    try {
      const fallbackServer = await startCallbackServer()
      try {
        expect(fallbackServer.port).toBeGreaterThan(19877)
        const response = await request(`http://${HOSTNAME}:${fallbackServer.port}/other`)
        expect(response.status).toBe(404)
      } finally {
        await close(fallbackServer)
      }
    } finally {
      await close(occupiedDefaultPort)
    }
  }, CALLBACK_SERVER_TEST_TIMEOUT_MS)
})
