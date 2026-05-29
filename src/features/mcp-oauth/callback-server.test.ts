/// <reference types="bun-types" />

import { afterEach, describe, expect, it } from "bun:test"
import { startCallbackServer, type CallbackServer } from "./callback-server"

const HOSTNAME = "127.0.0.1"

async function startTestCallbackServer(): Promise<CallbackServer> {
  return await startCallbackServer(0)
}

describe("startCallbackServer", () => {
  let server: CallbackServer | null = null

  async function request(url: string): Promise<Response> {
    return await Bun.fetch(url)
  }

  afterEach(async () => {
    server?.close()
    server = null
    await Bun.sleep(10)
  })

  it("starts server and returns port", async () => {
    server = await startTestCallbackServer()

    expect(server.port).toBeGreaterThan(0)
    expect(typeof server.waitForCallback).toBe("function")
    expect(typeof server.close).toBe("function")
  })

  it("resolves callback with code and state from query params", async () => {
    server = await startTestCallbackServer()
    const callbackUrl = `http://${HOSTNAME}:${server.port}/oauth/callback?code=test-code&state=test-state`

    const [result, response] = await Promise.all([
      server.waitForCallback(),
      request(callbackUrl),
    ])

    expect(result).toEqual({ code: "test-code", state: "test-state" })
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain("Authorization successful")
  })

  it("returns 404 for non-callback routes", async () => {
    server = await startTestCallbackServer()

    const response = await request(`http://${HOSTNAME}:${server.port}/other`)

    expect(response.status).toBe(404)
  })

  it("returns 400 and rejects when code is missing", async () => {
    server = await startTestCallbackServer()
    const callbackRejection = server.waitForCallback().catch((error: Error) => error)

    const response = await request(`http://${HOSTNAME}:${server.port}/oauth/callback?state=s`)

    expect(response.status).toBe(400)
    const error = await callbackRejection
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain("missing code or state")
  })

  it("returns 400 and rejects when state is missing", async () => {
    server = await startTestCallbackServer()
    const callbackRejection = server.waitForCallback().catch((error: Error) => error)

    const response = await request(`http://${HOSTNAME}:${server.port}/oauth/callback?code=c`)

    expect(response.status).toBe(400)
    const error = await callbackRejection
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain("missing code or state")
  })

  it("close stops the server immediately", async () => {
    server = await startTestCallbackServer()
    const port = server.port

    server.close()
    server = null

    try {
      await request(`http://${HOSTNAME}:${port}/oauth/callback?code=c&state=s`)
      expect.unreachable("request should fail after close")
    } catch (error) {
      expect(error).toBeDefined()
    }
  })
})
