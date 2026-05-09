import { describe, test, expect } from "bun:test"
import { createAnthropicAuthHook } from "./anthropic-auth-hook"

describe("anthropic-auth-hook", () => {
  test("creates hook with correct provider", () => {
    const hook = createAnthropicAuthHook()
    expect(hook.provider).toBe("anthropic")
  })

  test("has OAuth and API key methods", () => {
    const hook = createAnthropicAuthHook()
    expect(hook.methods).toHaveLength(2)
    expect(hook.methods[0].type).toBe("oauth")
    expect(hook.methods[0].label).toContain("Claude")
    expect(hook.methods[1].type).toBe("api")
    expect(hook.methods[1].label).toBe("API Key")
  })

  test("oauth method has authorize function", () => {
    const hook = createAnthropicAuthHook()
    const oauthMethod = hook.methods[0]
    expect(oauthMethod.type).toBe("oauth")
    if (oauthMethod.type === "oauth") {
      expect(typeof oauthMethod.authorize).toBe("function")
    }
  })

  test("api method has prompts and authorize", () => {
    const hook = createAnthropicAuthHook()
    const apiMethod = hook.methods[1]
    expect(apiMethod.type).toBe("api")
    if (apiMethod.type === "api") {
      expect(apiMethod.prompts).toBeDefined()
      expect(apiMethod.prompts!.length).toBeGreaterThan(0)
      expect(typeof apiMethod.authorize).toBe("function")
    }
  })

  test("api key validation rejects empty input", () => {
    const hook = createAnthropicAuthHook()
    const apiMethod = hook.methods[1]
    if (apiMethod.type === "api" && apiMethod.prompts) {
      const prompt = apiMethod.prompts[0]
      if (prompt.type === "text" && prompt.validate) {
        expect(prompt.validate("")).toBe("API key is required")
        expect(prompt.validate("  ")).toBe("API key is required")
        expect(prompt.validate("sk-ant-xxx")).toBeUndefined()
      }
    }
  })

  test("loader returns empty for no auth", async () => {
    const hook = createAnthropicAuthHook()
    if (hook.loader) {
      const result = await hook.loader(async () => undefined as any, {} as any)
      expect(result).toEqual({})
    }
  })

  test("loader returns empty for api key auth", async () => {
    const hook = createAnthropicAuthHook()
    if (hook.loader) {
      const result = await hook.loader(
        async () => ({ type: "api" as const, key: "sk-ant-xxx" }),
        {} as any,
      )
      expect(result).toEqual({})
    }
  })

  test("loader returns access token for valid oauth", async () => {
    const hook = createAnthropicAuthHook()
    if (hook.loader) {
      const result = await hook.loader(
        async () => ({
          type: "oauth" as const,
          access: "valid-access-token",
          refresh: "refresh-token",
          expires: Date.now() + 3600_000,
        }),
        {} as any,
      )
      expect(result).toHaveProperty("apiKey", "valid-access-token")
    }
  })
})
