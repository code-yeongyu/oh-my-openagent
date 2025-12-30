import { describe, it, expect, spyOn, afterEach } from "bun:test"
import * as auth from "./auth"

describe("auth check", () => {
  describe("getAuthProviderInfo", () => {
    it("returns anthropic as always available", () => {
      // #given anthropic provider
      // #when getting info
      const info = auth.getAuthProviderInfo("anthropic")

      // #then should show plugin installed (builtin)
      expect(info.id).toBe("anthropic")
      expect(info.pluginInstalled).toBe(true)
    })

    it("returns correct name for each provider", () => {
      // #given each provider
      // #when getting info
      // #then should have correct names
      expect(auth.getAuthProviderInfo("anthropic").name).toContain("Claude")
      expect(auth.getAuthProviderInfo("openai").name).toContain("ChatGPT")
      expect(auth.getAuthProviderInfo("google").name).toContain("Gemini")
    })
  })

  describe("checkAuthProvider", () => {
    let getInfoSpy: ReturnType<typeof spyOn>

    afterEach(() => {
      getInfoSpy?.mockRestore()
    })

    it("returns pass when plugin installed", async () => {
      // #given plugin installed
      getInfoSpy = spyOn(auth, "getAuthProviderInfo").mockReturnValue({
        id: "anthropic",
        name: "Anthropic (Claude)",
        pluginInstalled: true,
        configured: true,
      })

      // #when checking
      const result = await auth.checkAuthProvider("anthropic")

      // #then should pass
      expect(result.status).toBe("pass")
    })

    it("returns skip when plugin not installed", async () => {
      // #given plugin not installed
      getInfoSpy = spyOn(auth, "getAuthProviderInfo").mockReturnValue({
        id: "openai",
        name: "OpenAI (ChatGPT)",
        pluginInstalled: false,
        configured: false,
      })

      // #when checking
      const result = await auth.checkAuthProvider("openai")

      // #then should skip
      expect(result.status).toBe("skip")
      expect(result.message).toContain("not installed")
    })
  })

  describe("checkAnthropicAuth", () => {
    it("returns a check result", async () => {
      // #given
      // #when checking anthropic
      const result = await auth.checkAnthropicAuth()

      // #then should return valid result
      expect(result.name).toBeDefined()
      expect(["pass", "fail", "warn", "skip"]).toContain(result.status)
    })
  })

  describe("checkOpenAIAuth", () => {
    it("returns a check result", async () => {
      // #given
      // #when checking openai
      const result = await auth.checkOpenAIAuth()

      // #then should return valid result
      expect(result.name).toBeDefined()
      expect(["pass", "fail", "warn", "skip"]).toContain(result.status)
    })
  })

  describe("checkGoogleAuth", () => {
    it("returns a check result", async () => {
      // #given
      // #when checking google
      const result = await auth.checkGoogleAuth()

      // #then should return valid result
      expect(result.name).toBeDefined()
      expect(["pass", "fail", "warn", "skip"]).toContain(result.status)
    })
  })

  describe("getAuthCheckDefinitions", () => {
    it("returns definitions for all three providers", () => {
      // #given
      // #when getting definitions
      const defs = auth.getAuthCheckDefinitions()

      // #then should have 3 definitions
      expect(defs.length).toBe(3)
      expect(defs.every((d) => d.category === "authentication")).toBe(true)
    })
  })
})
