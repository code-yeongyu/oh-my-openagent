import { describe, expect, test } from "bun:test"

import providerMap from "../bin/lib/provider-map.json"
import { credentialGuidance } from "../bin/lib/setup-guidance.js"

function guidance(skippedOauth: string[], skippedUnmapped: string[], existing: Record<string, { type: string }> = {}) {
  return credentialGuidance({ skippedOauth, skippedUnmapped }, providerMap, existing)
}

describe("omo setup credential guidance", () => {
  describe("#given an OAuth credential that omo signs in for", () => {
    describe("#when the guidance is built", () => {
      test("#then each names the engine provider id to /login to", () => {
        const { logins } = guidance(["openai", "anthropic", "github-copilot"], [])

        expect(logins).toEqual([
          { provider: "openai", target: "chatgpt-subscription", state: "login" },
          { provider: "anthropic", target: "anthropic", state: "login" },
          { provider: "github-copilot", target: "github-copilot", state: "login" },
        ])
      })
    })
  })

  describe("#given the user already signed in to the omo provider", () => {
    describe("#when the guidance is built", () => {
      test("#then that login is not asked for again", () => {
        const { logins } = guidance(["openai"], [], { "chatgpt-subscription": { type: "oauth" } })

        expect(logins).toEqual([{ provider: "openai", target: "chatgpt-subscription", state: "signed-in" }])
      })
    })
  })

  describe("#given an OAuth credential with no omo provider", () => {
    describe("#when the guidance is built", () => {
      test("#then it has no /login target", () => {
        expect(guidance(["some-unknown-oauth"], []).logins).toEqual([{ provider: "some-unknown-oauth", state: "unsupported" }])
      })
    })
  })

  describe("#given an API key whose provider id matches no omo provider", () => {
    describe("#when the guidance is built", () => {
      test("#then it is listed as unmapped", () => {
        expect(guidance([], ["unknown-gateway"])).toEqual({ logins: [], unmapped: ["unknown-gateway"] })
      })
    })
  })
})

describe("omo setup provider map", () => {
  describe("#given the OpenCode provider ids seen in a real auth.json", () => {
    describe("#when they are resolved against the map", () => {
      test("#then every id that a builtin omo provider can serve resolves to it", () => {
        const resolve = (id: string): string | undefined =>
          (providerMap.builtinProviderIds as string[]).includes(id)
            ? id
            : (providerMap.providers as Record<string, string>)[id]

        // OpenCode Zen and Zen Go are builtin omo providers with the same endpoints
        // (https://opencode.ai/zen, https://opencode.ai/zen/go) and the same OPENCODE_API_KEY.
        expect(resolve("opencode")).toBe("opencode")
        expect(resolve("opencode-go")).toBe("opencode-go")
        // models.dev zai-coding-plan api == omo `zai` baseUrl (https://api.z.ai/api/coding/paas/v4).
        expect(resolve("zai-coding-plan")).toBe("zai")
        expect(resolve("kimi-for-coding")).toBe("kimi-coding")
        expect(resolve("unknown-gateway")).toBeUndefined()
      })
    })
  })
})
