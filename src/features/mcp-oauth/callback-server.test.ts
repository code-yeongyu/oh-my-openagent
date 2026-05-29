/// <reference types="bun-types" />

import { afterEach, describe, expect, it } from "bun:test"
import { startCallbackServer, type CallbackServer } from "./callback-server"

const HOSTNAME = "127.0.0.1"

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
    server = await startCallbackServer()

    expect(server.port).toBeGreaterThanOrEqual(19877)
    expect(typeof server.waitForCallback).toBe("function")
    expect(typeof server.close).toBe("function")
  })

  it("resolves callback with code and state from query params", async () => {
    server = await startCallbackServer()
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
    server = await startCallbackServer()

    const response = await request(`http://${HOSTNAME}:${server.port}/other`)

    expect(response.status).toBe(404)
  })

  it("returns 400 and rejects when code is missing", async () => {
    server = await startCallbackServer()
    const callbackRejection = server.waitForCallback().catch((error: Error) => error)

    const response = await request(`http://${HOSTNAME}:${server.port}/oauth/callback?state=s`)

    expect(response.status).toBe(400)
    const error = await callbackRejection
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain("missing code or state")
  })

  it("returns 400 and rejects when state is missing", async () => {
    server = await startCallbackServer()
    const callbackRejection = server.waitForCallback().catch((error: Error) => error)

    const response = await request(`http://${HOSTNAME}:${server.port}/oauth/callback?code=c`)

    expect(response.status).toBe(400)
    const error = await callbackRejection
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain("missing code or state")
  })

  it("close stops the server immediately", async () => {
    server = await startCallbackServer()
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
