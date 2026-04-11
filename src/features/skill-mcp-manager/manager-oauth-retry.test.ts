import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test"
import type { ClaudeCodeMcpServer } from "../claude-code-mcp-loader/types"
import type { OAuthTokenData } from "../mcp-oauth/storage"
import type { SkillMcpClientInfo, SkillMcpServerContext } from "./types"

const mockGetOrCreateClient = mock(async () => {
  throw new Error("not used")
})

const mockGetOrCreateClientWithRetryImpl = mock(async () => ({
  callTool: mock(async () => ({ content: [{ type: "text", text: "unused" }] })),
  close: mock(async () => {}),
}))

type ManagerModule = typeof import("./manager")

async function importFreshManagerModule(): Promise<ManagerModule> {
  mock.module("./connection", () => ({
    getOrCreateClient: mockGetOrCreateClient,
    getOrCreateClientWithRetryImpl: mockGetOrCreateClientWithRetryImpl,
  }))

  mock.module("../mcp-oauth/provider", () => ({
    McpOAuthProvider: class MockMcpOAuthProvider {},
  }))

  return await import(new URL(`./manager.ts?oauth-retry-test=${Date.now()}-${Math.random()}`, import.meta.url).href)
}

function createInfo(): SkillMcpClientInfo {
  return {
    serverName: "oauth-server",
    skillName: "oauth-skill",
    sessionID: "session-1",
    scope: "builtin",
  }
}

function createContext(): SkillMcpServerContext {
  return {
    skillName: "oauth-skill",
    config: {
      url: "https://mcp.example.com/mcp",
      oauth: { clientId: "test-client" },
    } satisfies ClaudeCodeMcpServer,
  }
}

afterAll(() => {
  mock.restore()
})

describe("SkillMcpManager post-request OAuth retry", () => {
  beforeEach(() => {
    mockGetOrCreateClient.mockClear()
    mockGetOrCreateClientWithRetryImpl.mockClear()
  })

  it("retries the operation after a 401 refresh succeeds", async () => {
    // given
    const { SkillMcpManager } = await importFreshManagerModule()
    const refresh = mock(async () => ({ accessToken: "refreshed-token" } satisfies OAuthTokenData))
    const manager = new SkillMcpManager({
      createOAuthProvider: () => ({
        tokens: () => ({ accessToken: "stale-token", refreshToken: "refresh-token" }),
        login: mock(async () => ({ accessToken: "login-token" } satisfies OAuthTokenData)),
        refresh,
      }),
    })
    const callTool = mock(async () => {
      if (callTool.mock.calls.length === 1) {
        throw new Error("401 Unauthorized")
      }

      return { content: [{ type: "text", text: "success" }] }
    })
    mockGetOrCreateClientWithRetryImpl.mockResolvedValue({ callTool, close: mock(async () => {}) })

    // when
    const result = await manager.callTool(createInfo(), createContext(), "test-tool", {})

    // then
    expect(result).toEqual([{ type: "text", text: "success" }])
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(callTool).toHaveBeenCalledTimes(2)
  })

  it("retries the operation after a 403 refresh succeeds without step-up scope", async () => {
    // given
    const { SkillMcpManager } = await importFreshManagerModule()
    const refresh = mock(async () => ({ accessToken: "refreshed-token" } satisfies OAuthTokenData))
    const manager = new SkillMcpManager({
      createOAuthProvider: () => ({
        tokens: () => ({ accessToken: "stale-token", refreshToken: "refresh-token" }),
        login: mock(async () => ({ accessToken: "login-token" } satisfies OAuthTokenData)),
        refresh,
      }),
    })
    const callTool = mock(async () => {
      if (callTool.mock.calls.length === 1) {
        throw new Error("403 Forbidden")
      }

      return { content: [{ type: "text", text: "success" }] }
    })
    mockGetOrCreateClientWithRetryImpl.mockResolvedValue({ callTool, close: mock(async () => {}) })

    // when
    const result = await manager.callTool(createInfo(), createContext(), "test-tool", {})

    // then
    expect(result).toEqual([{ type: "text", text: "success" }])
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(callTool).toHaveBeenCalledTimes(2)
  })

  it("propagates the auth error without retry when refresh fails", async () => {
    // given
    const { SkillMcpManager } = await importFreshManagerModule()
    const refresh = mock(async () => {
      throw new Error("refresh failed")
    })
    const manager = new SkillMcpManager({
      createOAuthProvider: () => ({
        tokens: () => ({ accessToken: "stale-token", refreshToken: "refresh-token" }),
        login: mock(async () => ({ accessToken: "login-token" } satisfies OAuthTokenData)),
        refresh,
      }),
    })
    const callTool = mock(async () => {
      throw new Error("401 Unauthorized")
    })
    mockGetOrCreateClientWithRetryImpl.mockResolvedValue({ callTool, close: mock(async () => {}) })

    // when / then
    await expect(manager.callTool(createInfo(), createContext(), "test-tool", {})).rejects.toThrow("401 Unauthorized")
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(callTool).toHaveBeenCalledTimes(1)
  })

  it("only attempts one refresh when the retried operation returns 401 again", async () => {
    // given
    const { SkillMcpManager } = await importFreshManagerModule()
    const refresh = mock(async () => ({ accessToken: "refreshed-token" } satisfies OAuthTokenData))
    const manager = new SkillMcpManager({
      createOAuthProvider: () => ({
        tokens: () => ({ accessToken: "stale-token", refreshToken: "refresh-token" }),
        login: mock(async () => ({ accessToken: "login-token" } satisfies OAuthTokenData)),
        refresh,
      }),
    })
    const callTool = mock(async () => {
      throw new Error("401 Unauthorized")
    })
    mockGetOrCreateClientWithRetryImpl.mockResolvedValue({ callTool, close: mock(async () => {}) })

    // when / then
    await expect(manager.callTool(createInfo(), createContext(), "test-tool", {})).rejects.toThrow("401 Unauthorized")
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(callTool).toHaveBeenCalledTimes(2)
  })
})
