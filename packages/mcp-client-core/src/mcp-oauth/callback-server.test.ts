import { describe, expect, it } from "bun:test"
import { startCallbackServer } from "./callback-server"

const HOSTNAME = "127.0.0.1"
const TEST_TIMEOUT_MS = process.platform === "win32" ? 15_000 : 5_000

describe("OAuth callback server HTTP responses", () => {
  it("#given a running callback server #when requesting an unknown route #then it returns a plain-text 404", async () => {
    // given
    const server = await startCallbackServer(0)

    try {
      // when
      const response = await fetch(`http://${HOSTNAME}:${server.port}/unknown`)

      // then
      expect(response.status).toBe(404)
      expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8")
      expect(response.headers.get("x-content-type-options")).toBe("nosniff")
      expect(await response.text()).toBe("Not Found")
    } finally {
      await server.close()
    }
  }, TEST_TIMEOUT_MS)

  it("#given a running callback server #when OAuth returns an error #then it returns a plain-text 400 and rejects the callback", async () => {
    // given
    const server = await startCallbackServer(0)
    const callbackResult = server.waitForCallback().then(
      () => null,
      (error: unknown) => error,
    )

    try {
      // when
      const response = await fetch(
        `http://${HOSTNAME}:${server.port}/oauth/callback?error=access_denied&error_description=${encodeURIComponent("<script>alert(1)</script>")}`,
      )

      // then
      expect(response.status).toBe(400)
      expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8")
      expect(response.headers.get("x-content-type-options")).toBe("nosniff")
      expect(await response.text()).toBe("Authorization failed: <script>alert(1)</script>")

      const error = await callbackResult
      expect(error).toBeInstanceOf(Error)
      if (!(error instanceof Error)) {
        throw new Error("Expected OAuth callback to reject with an Error")
      }
      expect(error.message).toBe("OAuth authorization failed: <script>alert(1)</script>")
    } finally {
      await server.close()
    }
  }, TEST_TIMEOUT_MS)

  it("#given a running callback server #when the callback misses code or state #then it returns a plain-text nosniff 400 and rejects the callback", async () => {
    // given
    const server = await startCallbackServer(0)
    const callbackResult = server.waitForCallback().then(
      () => null,
      (error: unknown) => error,
    )

    try {
      // when
      const response = await fetch(`http://${HOSTNAME}:${server.port}/oauth/callback`)

      // then
      expect(response.status).toBe(400)
      expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8")
      expect(response.headers.get("x-content-type-options")).toBe("nosniff")
      expect(await response.text()).toBe("Missing code or state parameter")

      const error = await callbackResult
      expect(error).toBeInstanceOf(Error)
    } finally {
      await server.close()
    }
  }, TEST_TIMEOUT_MS)

  it("#given a running callback server #when OAuth returns code and state #then it returns HTML and resolves the callback", async () => {
    // given
    const server = await startCallbackServer(0)

    try {
      // when
      const [callback, response] = await Promise.all([
        server.waitForCallback(),
        fetch(`http://${HOSTNAME}:${server.port}/oauth/callback?code=code-123&state=state-456`),
      ])

      // then
      expect(callback).toEqual({ code: "code-123", state: "state-456" })
      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8")
      expect(await response.text()).toContain("Authorization successful")
    } finally {
      await server.close()
    }
  }, TEST_TIMEOUT_MS)
})
