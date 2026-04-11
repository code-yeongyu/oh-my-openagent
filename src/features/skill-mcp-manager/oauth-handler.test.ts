import { describe, expect, it, mock } from "bun:test"
import type { ClaudeCodeMcpServer } from "../claude-code-mcp-loader/types"
import type { OAuthTokenData } from "../mcp-oauth/storage"
import type { OAuthProviderFactory, OAuthProviderLike } from "./types"

type OAuthHandlerModule = typeof import("./oauth-handler")

async function importFreshOAuthHandlerModule(): Promise<OAuthHandlerModule> {
  mock.module("../mcp-oauth/provider", () => ({
    McpOAuthProvider: class MockMcpOAuthProvider {},
  }))

  return await import(new URL(`./oauth-handler.ts?oauth-handler-test=${Date.now()}-${Math.random()}`, import.meta.url).href)
}

type Deferred<TValue> = {
  promise: Promise<TValue>
  resolve: (value: TValue) => void
}

function createDeferred<TValue>(): Deferred<TValue> {
  let resolvePromise: ((value: TValue) => void) | null = null
  const promise = new Promise<TValue>((resolve) => {
    resolvePromise = resolve
  })

  if (!resolvePromise) {
    throw new Error("Failed to create deferred promise")
  }

  return { promise, resolve: resolvePromise }
}

function createConfig(serverUrl: string): ClaudeCodeMcpServer {
  return {
    url: serverUrl,
    oauth: {
      clientId: "test-client",
    },
  }
}

describe("oauth-handler refresh mutex wiring", () => {
  it("deduplicates concurrent pre-request refresh attempts for the same server", async () => {
    // given
    const { buildHttpRequestInit } = await importFreshOAuthHandlerModule()
    const deferred = createDeferred<OAuthTokenData>()
    const refresh = mock(() => deferred.promise)
    const provider: OAuthProviderLike = {
      tokens: () => ({
        accessToken: "expired-token",
        refreshToken: "refresh-token",
        expiresAt: Math.floor(Date.now() / 1000) - 60,
      }),
      login: mock(async () => ({ accessToken: "login-token" } satisfies OAuthTokenData)),
      refresh,
    }
    const authProviders = new Map<string, OAuthProviderLike>()
    const createOAuthProvider: OAuthProviderFactory = () => provider

    // when
    const firstRequest = buildHttpRequestInit(createConfig("https://same.example.com/mcp"), authProviders, createOAuthProvider)
    const secondRequest = buildHttpRequestInit(createConfig("https://same.example.com/mcp"), authProviders, createOAuthProvider)

    // then
    expect(refresh).toHaveBeenCalledTimes(1)
    deferred.resolve({ accessToken: "refreshed-token" })
    await expect(firstRequest).resolves.toEqual({ headers: { Authorization: "Bearer refreshed-token" } })
    await expect(secondRequest).resolves.toEqual({ headers: { Authorization: "Bearer refreshed-token" } })
  })

  it("allows different servers to refresh independently after request auth errors", async () => {
    // given
    const { handlePostRequestAuthError } = await importFreshOAuthHandlerModule()
    const firstDeferred = createDeferred<OAuthTokenData>()
    const secondDeferred = createDeferred<OAuthTokenData>()
    const firstProvider: OAuthProviderLike = {
      tokens: () => ({ accessToken: "expired-a", refreshToken: "refresh-a" }),
      login: mock(async () => ({ accessToken: "login-a" } satisfies OAuthTokenData)),
      refresh: mock(() => firstDeferred.promise),
    }
    const secondProvider: OAuthProviderLike = {
      tokens: () => ({ accessToken: "expired-b", refreshToken: "refresh-b" }),
      login: mock(async () => ({ accessToken: "login-b" } satisfies OAuthTokenData)),
      refresh: mock(() => secondDeferred.promise),
    }
    const providers = new Map([
      ["https://server-a.example.com/mcp", firstProvider],
      ["https://server-b.example.com/mcp", secondProvider],
    ])

    // when
    const firstAttempt = handlePostRequestAuthError({
      error: new Error("401 Unauthorized"),
      config: createConfig("https://server-a.example.com/mcp"),
      authProviders: providers,
    })
    const secondAttempt = handlePostRequestAuthError({
      error: new Error("403 Forbidden"),
      config: createConfig("https://server-b.example.com/mcp"),
      authProviders: providers,
    })

    // then
    expect(firstProvider.refresh).toHaveBeenCalledTimes(1)
    expect(secondProvider.refresh).toHaveBeenCalledTimes(1)
    firstDeferred.resolve({ accessToken: "refreshed-a" })
    secondDeferred.resolve({ accessToken: "refreshed-b" })
    await expect(firstAttempt).resolves.toBe(true)
    await expect(secondAttempt).resolves.toBe(true)
  })

  it("allows a new refresh after the previous same-server refresh completes", async () => {
    // given
    const { handlePostRequestAuthError } = await importFreshOAuthHandlerModule()
    const refresh = mock(async () => ({ accessToken: `refreshed-${refresh.mock.calls.length + 1}` } satisfies OAuthTokenData))
    const provider: OAuthProviderLike = {
      tokens: () => ({ accessToken: "expired-token", refreshToken: "refresh-token" }),
      login: mock(async () => ({ accessToken: "login-token" } satisfies OAuthTokenData)),
      refresh,
    }
    const authProviders = new Map<string, OAuthProviderLike>([["https://same.example.com/mcp", provider]])

    // when
    const firstResult = await handlePostRequestAuthError({
      error: new Error("401 Unauthorized"),
      config: createConfig("https://same.example.com/mcp"),
      authProviders,
    })
    const secondResult = await handlePostRequestAuthError({
      error: new Error("401 Unauthorized"),
      config: createConfig("https://same.example.com/mcp"),
      authProviders,
    })

    // then
    expect(firstResult).toBe(true)
    expect(secondResult).toBe(true)
    expect(refresh).toHaveBeenCalledTimes(2)
  })
})
