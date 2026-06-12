import { describe, expect, it, mock, spyOn } from "bun:test"
import type { ClaudeCodeMcpServer } from "../claude-code-mcp-loader/types"
import type { OAuthTokenData } from "../mcp-oauth/storage"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { SkillMcpManager } from "./manager"
import type { McpClient, SkillMcpClientInfo, SkillMcpServerContext } from "./types"

type ManagerWithPrivateRetry = {
  getOrCreateClientWithRetry: (info: SkillMcpClientInfo, config: ClaudeCodeMcpServer) => Promise<McpClient>
}

function stubClientRetry(manager: SkillMcpManager, callTool: McpClient["callTool"]): void {
  const client = unsafeTestValue<McpClient>({
    callTool,
    close: mock(async () => {}),
  })
  spyOn(unsafeTestValue<ManagerWithPrivateRetry>(manager), "getOrCreateClientWithRetry").mockResolvedValue(client)
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

describe("SkillMcpManager post-request OAuth retry", () => {
  it("retries the operation after a 401 refresh succeeds", async () => {
    // given
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
    stubClientRetry(manager, callTool)

    // when
    const result = await manager.callTool(createInfo(), createContext(), "test-tool", {})

    // then
    expect(result).toEqual([{ type: "text", text: "success" }])
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(callTool).toHaveBeenCalledTimes(2)
  })

  it("retries the operation after a 403 refresh succeeds without step-up scope", async () => {
    // given
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
    stubClientRetry(manager, callTool)

    // when
    const result = await manager.callTool(createInfo(), createContext(), "test-tool", {})

    // then
    expect(result).toEqual([{ type: "text", text: "success" }])
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(callTool).toHaveBeenCalledTimes(2)
  })

  it("propagates the auth error without retry when refresh fails", async () => {
    // given
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
    stubClientRetry(manager, callTool)

    // when / then
    await expect(manager.callTool(createInfo(), createContext(), "test-tool", {})).rejects.toThrow("401 Unauthorized")
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(callTool).toHaveBeenCalledTimes(1)
  })

  it("only attempts one refresh when the retried operation returns 401 again", async () => {
    // given
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
    stubClientRetry(manager, callTool)

    // when / then
    await expect(manager.callTool(createInfo(), createContext(), "test-tool", {})).rejects.toThrow("401 Unauthorized")
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(callTool).toHaveBeenCalledTimes(2)
  })
})
