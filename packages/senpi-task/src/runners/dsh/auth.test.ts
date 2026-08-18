import { describe, expect, test } from "bun:test"

import { resolveDshAuth } from "./auth"

describe("resolveDshAuth", () => {
  test("#given explicit DEEPSEEK env vars #when resolved #then they win over every other source", async () => {
    // given
    const getApiKeyForProvider = async () => "sk-engine"
    const readFile = () => JSON.stringify({ "opencode-go": { type: "api_key", key: "sk-auth-file" } })

    // when
    const auth = await resolveDshAuth(
      {
        DEEPSEEK_API_KEY: "sk-explicit",
        DEEPSEEK_BASE_URL: "https://custom/v1",
        DSH_MODEL: "deepseek-v4-pro",
      } as NodeJS.ProcessEnv,
      { getApiKeyForProvider, readFile, authPath: "/fake/auth.json" },
    )

    // then
    expect(auth.apiKey).toBe("sk-explicit")
    expect(auth.baseUrl).toBe("https://custom/v1")
    expect(auth.model).toBe("deepseek-v4-pro")
  })

  test("#given an engine accessor returning a key #when resolved #then the engine credential wins over auth.json", async () => {
    // given
    const getApiKeyForProvider = async (provider: string) =>
      provider === "opencode-go" ? "sk-engine" : undefined
    const readFile = () => JSON.stringify({ "opencode-go": { type: "api_key", key: "sk-auth-file" } })

    // when
    const auth = await resolveDshAuth({}, { getApiKeyForProvider, readFile, authPath: "/fake/auth.json" })

    // then
    expect(auth.apiKey).toBe("sk-engine")
    expect(auth.baseUrl).toBe("https://opencode.ai/zen/go/v1")
    expect(auth.model).toBe("deepseek-v4-flash")
  })

  test("#given a native auth.json with an api_key entry #when read via injected readFile #then the key and defaults are used", async () => {
    // given
    const readFile = () => JSON.stringify({ "opencode-go": { type: "api_key", key: "sk-native" } })

    // when
    const auth = await resolveDshAuth({}, { readFile, authPath: "/fake/auth.json" })

    // then
    expect(auth.apiKey).toBe("sk-native")
    expect(auth.baseUrl).toBe("https://opencode.ai/zen/go/v1")
    expect(auth.model).toBe("deepseek-v4-flash")
  })

  test("#given a missing auth file #when resolved #then returns an empty object", async () => {
    // given
    const readFile = () => {
      throw new Error("ENOENT: no such file")
    }

    // when
    const auth = await resolveDshAuth({}, { readFile, authPath: "/nonexistent/auth.json" })

    // then
    expect(auth.apiKey).toBeUndefined()
    expect(auth.baseUrl).toBeUndefined()
    expect(auth.model).toBeUndefined()
  })

  test("#given an auth.json with the legacy api spelling #when resolved #then the key is still accepted", async () => {
    // given
    const readFile = () => JSON.stringify({ "opencode-go": { type: "api", key: "sk-legacy" } })

    // when
    const auth = await resolveDshAuth({}, { readFile, authPath: "/fake/auth.json" })

    // then
    expect(auth.apiKey).toBe("sk-legacy")
    expect(auth.baseUrl).toBe("https://opencode.ai/zen/go/v1")
    expect(auth.model).toBe("deepseek-v4-flash")
  })
})