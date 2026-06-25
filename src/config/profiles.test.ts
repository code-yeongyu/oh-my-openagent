import { describe, expect, it, test } from "bun:test"
import { expandProfile, PROFILE_NAMES } from "./profiles"

describe("expandProfile", () => {
  describe("budget profile", () => {
    test("should set morpheus to sonnet", () => {
      //#given
      //#when
      const result = expandProfile("budget")

      //#then
      expect(result.agents?.morpheus?.model).toBe(
        "anthropic/claude-sonnet-4-6"
      )
    })

    test("should set oracle to haiku", () => {
      //#given
      //#when
      const result = expandProfile("budget")

      //#then
      expect(result.agents?.oracle?.model).toBe("anthropic/claude-haiku-4-5")
    })

    test("should set source category to sonnet", () => {
      //#given
      //#when
      const result = expandProfile("budget")

      //#then
      expect(result.categories?.source?.model).toBe("anthropic/claude-sonnet-4-6")
    })

    test("should set bullet-time category to haiku", () => {
      //#given
      //#when
      const result = expandProfile("budget")

      //#then
      expect(result.categories?.["bullet-time"]?.model).toBe("anthropic/claude-haiku-4-5")
    })

    test("should set sati to anthropic/claude-haiku-4-5 (frontend specialist)", () => {
      //#given
      //#when
      const result = expandProfile("budget")

      //#then
      expect(result.agents?.sati?.model).toBe("anthropic/claude-haiku-4-5")
    })
  })

  describe("balanced profile", () => {
    test("should set morpheus to opus", () => {
      //#given
      //#when
      const result = expandProfile("balanced")

      //#then
      expect(result.agents?.morpheus?.model).toBe(
        "anthropic/claude-opus-4-6"
      )
    })

    test("should set oracle to sonnet", () => {
      //#given
      //#when
      const result = expandProfile("balanced")

      //#then
      expect(result.agents?.oracle?.model).toBe(
        "anthropic/claude-sonnet-4-6"
      )
    })

    test("should set source category to opus", () => {
      //#given
      //#when
      const result = expandProfile("balanced")

      //#then
      expect(result.categories?.source?.model).toBe(
        "anthropic/claude-opus-4-6"
      )
    })

    test("should set deep-jack category to sonnet", () => {
      //#given
      //#when
      const result = expandProfile("balanced")

      //#then
      expect(result.categories?.["deep-jack"]?.model).toBe("anthropic/claude-sonnet-4-6")
    })

    test("should set bullet-time category to haiku", () => {
      //#given
      //#when
      const result = expandProfile("balanced")

      //#then
      expect(result.categories?.["bullet-time"]?.model).toBe("anthropic/claude-haiku-4-5")
    })

    test("should set sati to anthropic/claude-sonnet-4-6 (frontend specialist)", () => {
      //#given
      //#when
      const result = expandProfile("balanced")

      //#then
      expect(result.agents?.sati?.model).toBe("anthropic/claude-sonnet-4-6")
    })
  })

  describe("performance profile", () => {
    test("should set morpheus to opus", () => {
      //#given
      //#when
      const result = expandProfile("performance")

      //#then
      expect(result.agents?.morpheus?.model).toBe(
        "anthropic/claude-opus-4-6"
      )
    })

    test("should set oracle to opus", () => {
      //#given
      //#when
      const result = expandProfile("performance")

      //#then
      expect(result.agents?.oracle?.model).toBe(
        "anthropic/claude-opus-4-6"
      )
    })

    test("should set source category to opus", () => {
      //#given
      //#when
      const result = expandProfile("performance")

      //#then
      expect(result.categories?.source?.model).toBe(
        "anthropic/claude-opus-4-6"
      )
    })

    test("should set merovingian to sonnet", () => {
      //#given
      //#when
      const result = expandProfile("performance")

      //#then
      expect(result.agents?.merovingian?.model).toBe("anthropic/claude-sonnet-4-6")
    })

    test("should set trinity to haiku", () => {
      //#given
      //#when
      const result = expandProfile("performance")

      //#then
      expect(result.agents?.trinity?.model).toBe("anthropic/claude-haiku-4-5")
    })

    test("should set bullet-time category to haiku", () => {
      //#given
      //#when
      const result = expandProfile("performance")

      //#then
      expect(result.categories?.["bullet-time"]?.model).toBe("anthropic/claude-haiku-4-5")
    })

    test("should set sati to anthropic/claude-opus-4-6 (frontend specialist)", () => {
      //#given
      //#when
      const result = expandProfile("performance")

      //#then
      expect(result.agents?.sati?.model).toBe("anthropic/claude-opus-4-6")
    })
  })

  describe("economy profile", () => {
    test("should set morpheus to sonnet", () => {
      //#given
      //#when
      const result = expandProfile("economy")

      //#then
      expect(result.agents?.morpheus?.model).toBe(
        "anthropic/claude-sonnet-4-6"
      )
    })

    test("should set oracle to sonnet", () => {
      //#given
      //#when
      const result = expandProfile("economy")

      //#then
      expect(result.agents?.oracle?.model).toBe(
        "anthropic/claude-sonnet-4-6"
      )
    })

    test("should set source category to sonnet", () => {
      //#given
      //#when
      const result = expandProfile("economy")

      //#then
      expect(result.categories?.source?.model).toBe(
        "anthropic/claude-sonnet-4-6"
      )
    })

    test("should set merovingian to sonnet", () => {
      //#given
      //#when
      const result = expandProfile("economy")

      //#then
      expect(result.agents?.merovingian?.model).toBe("anthropic/claude-sonnet-4-6")
    })

    test("should set bullet-time category to haiku", () => {
      //#given
      //#when
      const result = expandProfile("economy")

      //#then
      expect(result.categories?.["bullet-time"]?.model).toBe("anthropic/claude-haiku-4-5")
    })

    test("should set sati to anthropic/claude-sonnet-4-6 (frontend specialist)", () => {
      //#given
      //#when
      const result = expandProfile("economy")

      //#then
      expect(result.agents?.sati?.model).toBe("anthropic/claude-sonnet-4-6")
    })
  })

  describe("free profile", () => {
    test("should set morpheus to kimi-k2.5-free", () => {
      //#given
      //#when
      const result = expandProfile("free")

      //#then
      expect(result.agents?.morpheus?.model).toBe("opencode/kimi-k2.5-free")
    })

    test("should set oracle to kimi-k2.5-free", () => {
      //#given
      //#when
      const result = expandProfile("free")

      //#then
      expect(result.agents?.oracle?.model).toBe("opencode/kimi-k2.5-free")
    })

    test("should set trinity to grok-code-fast-1", () => {
      //#given
      //#when
      const result = expandProfile("free")

      //#then
      expect(result.agents?.trinity?.model).toBe("xai/grok-code-fast-1")
    })

    test("should set operator to glm-4.7", () => {
      //#given
      //#when
      const result = expandProfile("free")

      //#then
      expect(result.agents?.operator?.model).toBe("zai-coding-plan/glm-4.7")
    })

    test("should set source category to kimi-k2.5-free", () => {
      //#given
      //#when
      const result = expandProfile("free")

      //#then
      expect(result.categories?.source?.model).toBe("opencode/kimi-k2.5-free")
    })

    test("should set bullet-time category to minimax-m2.5-free", () => {
      //#given
      //#when
      const result = expandProfile("free")

      //#then
      expect(result.categories?.["bullet-time"]?.model).toBe("minimax-m2.5-free")
    })

    test("should set mouse to minimax-m2.5-free", () => {
      //#given
      //#when
      const result = expandProfile("free")

      //#then
      expect(result.agents?.mouse?.model).toBe("minimax-m2.5-free")
    })

    test("should set sati to opencode/kimi-k2.5-free (frontend specialist)", () => {
      //#given
      //#when
      const result = expandProfile("free")

      //#then
      expect(result.agents?.sati?.model).toBe("opencode/kimi-k2.5-free")
    })
  })

  describe("go profile", () => {
    test("should set morpheus to opencode-go/glm-5.1 (orchestrator tier)", () => {
      //#given
      //#when
      const result = expandProfile("go")

      //#then
      expect(result.agents?.morpheus?.model).toBe("opencode-go/glm-5.1")
    })

    test("should set keymaker to opencode-go/kimi-k2.6 (deep worker tier)", () => {
      //#given
      //#when
      const result = expandProfile("go")

      //#then
      expect(result.agents?.keymaker?.model).toBe("opencode-go/kimi-k2.6")
    })

    test("should set sentinel to opencode-go/deepseek-v4-pro (qa/review tier)", () => {
      //#given
      //#when
      const result = expandProfile("go")

      //#then
      expect(result.agents?.sentinel?.model).toBe("opencode-go/deepseek-v4-pro")
    })

    test("should set operator to opencode-go/deepseek-v4-flash (automation tier)", () => {
      //#given
      //#when
      const result = expandProfile("go")

      //#then
      expect(result.agents?.operator?.model).toBe("opencode-go/deepseek-v4-flash")
    })

    test("should set trinity to opencode-go/deepseek-v4-flash", () => {
      //#given
      //#when
      const result = expandProfile("go")

      //#then
      expect(result.agents?.trinity?.model).toBe("opencode-go/deepseek-v4-flash")
    })

    test("should set source category to opencode-go/kimi-k2.6", () => {
      //#given
      //#when
      const result = expandProfile("go")

      //#then
      expect(result.categories?.source?.model).toBe("opencode-go/kimi-k2.6")
    })

    test("should set bullet-time category to opencode-go/deepseek-v4-flash", () => {
      //#given
      //#when
      const result = expandProfile("go")

      //#then
      expect(result.categories?.["bullet-time"]?.model).toBe("opencode-go/deepseek-v4-flash")
    })

    test("should set sati to opencode-go/kimi-k2.6 (deep worker tier)", () => {
      //#given
      //#when
      const result = expandProfile("go")

      //#then
      expect(result.agents?.sati?.model).toBe("opencode-go/kimi-k2.6")
    })
  })

  describe("xiaomi-ultimate profile", () => {
    test("should set sati to xiaomi-token-plan-ams/mimo-v2.5-pro (deep worker tier)", () => {
      //#given
      //#when
      const result = expandProfile("xiaomi-ultimate")

      //#then
      expect(result.agents?.sati?.model).toBe("xiaomi-token-plan-ams/mimo-v2.5-pro")
    })
  })

  describe("go-ultimate profile", () => {
    test("should set sati to opencode-go/kimi-k2.6 (deep worker tier)", () => {
      //#given
      //#when
      const result = expandProfile("go-ultimate")

      //#then
      expect(result.agents?.sati?.model).toBe("opencode-go/kimi-k2.6")
    })
  })

  describe("go-trio profile", () => {
    test("should set sati to opencode-go/mimo-v2.5 (deep worker tier)", () => {
      //#given
      //#when
      const result = expandProfile("go-trio")

      //#then
      expect(result.agents?.sati?.model).toBe("opencode-go/mimo-v2.5")
    })
  })

  describe("go-duo profile", () => {
    //#given the go-duo profile exists in the registry
    const result = expandProfile("go-duo")

    it("contains the full agent roster (14 agents)", () => {
      //#then all 14 built-in agents are present
      expect(Object.keys(result.agents ?? {})).toHaveLength(14)
    })

    it("contains the full category roster (8 categories)", () => {
      //#then all 8 categories are present
      expect(Object.keys(result.categories ?? {})).toHaveLength(8)
    })

    it("assigns Sati to deepseek-v4-flash (UI reasoning)", () => {
      //#then Sati is on the deepseek tier (UI tradeoffs benefit from deeper reasoning)
      expect(result.agents?.sati?.model).toBe("opencode-go/deepseek-v4-flash")
    })

    it("assigns Oracle to deepseek-v4-flash (reasoning)", () => {
      //#then Oracle is on the deepseek tier
      expect(result.agents?.oracle?.model).toBe("opencode-go/deepseek-v4-flash")
    })

    it("assigns Cipher to deepseek-v4-flash (DSL)", () => {
      //#then Cipher is on the deepseek tier
      expect(result.agents?.cipher?.model).toBe("opencode-go/deepseek-v4-flash")
    })

    it("assigns source category to deepseek-v4-flash", () => {
      //#then reasoning-heavy category uses deepseek
      expect(result.categories?.source?.model).toBe("opencode-go/deepseek-v4-flash")
    })

    it("assigns blue-pill category to mimo-v2.5", () => {
      //#then utility category uses mimo
      expect(result.categories?.["blue-pill"]?.model).toBe("opencode-go/mimo-v2.5")
    })

    it("contains only the two allowed models across all agents", () => {
      //#given the closed allow-set
      const allowed = new Set([
        "opencode-go/mimo-v2.5",
        "opencode-go/deepseek-v4-flash",
      ])
      //#then every agent's model is in the set
      for (const [name, override] of Object.entries(result.agents ?? {})) {
        expect({ name, model: override.model }).toEqual({
          name,
          model: expect.stringMatching(
            /^opencode-go\/(mimo-v2\.5|deepseek-v4-flash)$/,
          ),
        })
      }
      //#then no other models leak in
      const allModels = Object.values(result.agents ?? {}).map((o) => o.model)
      for (const m of allModels) {
        expect(allowed.has(m ?? "")).toBe(true)
      }
    })

    it("contains only the two allowed models across all categories", () => {
      //#given the closed allow-set
      const allowed = new Set([
        "opencode-go/mimo-v2.5",
        "opencode-go/deepseek-v4-flash",
      ])
      //#then no other category models leak in
      const allModels = Object.values(result.categories ?? {}).map((o) => o.model)
      for (const m of allModels) {
        expect(allowed.has(m ?? "")).toBe(true)
      }
    })

    it("pins fallbackChain for every agent to the OTHER go-duo model", () => {
      //#then no agent falls through to a non-go-duo model
      for (const [name, override] of Object.entries(result.agents ?? {})) {
        const primary = override.model
        const chain = override.fallbackChain ?? []
        expect(chain.length).toBeGreaterThan(0)
        const first = chain[0]
        //#then fallback points to the OTHER model
        if (primary === "opencode-go/mimo-v2.5") {
          expect(first?.model).toBe("opencode-go/deepseek-v4-flash")
        } else if (primary === "opencode-go/deepseek-v4-flash") {
          expect(first?.model).toBe("opencode-go/mimo-v2.5")
        } else {
          throw new Error(
            `Agent ${name} primary model ${primary} is not in go-duo set`,
          )
        }
        //#then fallback is on the opencode-go provider
        expect(first?.providers).toEqual(["opencode-go"])
      }
    })

    it("distributes agents 9 deepseek / 5 mimo (intentional imbalance)", () => {
      //#then the count matches the documented split
      const deepseek = Object.values(result.agents ?? {}).filter(
        (o) => o.model === "opencode-go/deepseek-v4-flash",
      )
      const mimo = Object.values(result.agents ?? {}).filter(
        (o) => o.model === "opencode-go/mimo-v2.5",
      )
      expect(deepseek).toHaveLength(9)
      expect(mimo).toHaveLength(5)
    })

    it("is registered as a valid profile name in PROFILE_NAMES", () => {
      //#then "go-duo" is one of the 10 profile names
      expect(PROFILE_NAMES).toContain("go-duo")
    })
  })

  describe("PROFILE_NAMES", () => {
    test("should export all profile names", () => {
      //#given
      //#when
      //#then
      expect(PROFILE_NAMES).toContain("free")
      expect(PROFILE_NAMES).toContain("budget")
      expect(PROFILE_NAMES).toContain("economy")
      expect(PROFILE_NAMES).toContain("balanced")
      expect(PROFILE_NAMES).toContain("performance")
      expect(PROFILE_NAMES).toContain("go")
      expect(PROFILE_NAMES).toContain("xiaomi-ultimate")
      expect(PROFILE_NAMES).toContain("go-ultimate")
      expect(PROFILE_NAMES).toContain("go-trio")
      expect(PROFILE_NAMES).toContain("go-duo")
      expect(PROFILE_NAMES).toHaveLength(10)
    })
  })
})
