import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test"

const mockLogin = mock(() => Promise.resolve({ accessToken: "test-token", expiresAt: 1710000000 }))

mock.module("../../features/mcp-oauth/provider", () => ({
  McpOAuthProvider: class MockMcpOAuthProvider {
    constructor(public options: { serverUrl: string; clientId?: string; scopes?: string[] }) {}
    async login() {
      return mockLogin()
    }
  },
}))

const { login } = await import("./login")

describe("login command", () => {
  beforeEach(() => {
    mockLogin.mockClear()
  })

  afterEach(() => {
    // cleanup
  })

  it("returns error code when server-url is not provided", async () => {
    // given
    const serverName = "test-server"
    const options = {}

    // when
    const exitCode = await login(serverName, options)

    // then
    expect(exitCode).toBe(1)
  })

  it("returns success code when login succeeds", async () => {
    // given
    const serverName = "test-server"
    const options = {
      serverUrl: "https://oauth.example.com",
    }

    // when
    const exitCode = await login(serverName, options)

    // then
    expect(exitCode).toBe(0)
    expect(mockLogin).toHaveBeenCalledTimes(1)
  })

  it("returns error code when login throws", async () => {
    // given
    const serverName = "test-server"
    const options = {
      serverUrl: "https://oauth.example.com",
    }
    mockLogin.mockRejectedValueOnce(new Error("Network error"))

    // when
    const exitCode = await login(serverName, options)

    // then
    expect(exitCode).toBe(1)
  })

  it("returns error code when server-url is missing", async () => {
    // given
    const serverName = "test-server"
    const options = {
      clientId: "test-client-id",
    }

    // when
    const exitCode = await login(serverName, options)

    // then
    expect(exitCode).toBe(1)
  })
})
