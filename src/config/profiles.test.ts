import { describe, expect, test } from "bun:test"
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
      expect(result.categories?.["source"]?.model).toBe("anthropic/claude-sonnet-4-6")
    })

    test("should set bullet-time category to haiku", () => {
      //#given
      //#when
      const result = expandProfile("budget")

      //#then
      expect(result.categories?.["bullet-time"]?.model).toBe("anthropic/claude-haiku-4-5")
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
      expect(result.categories?.["source"]?.model).toBe(
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
      expect(result.categories?.["source"]?.model).toBe(
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
      expect(result.categories?.["source"]?.model).toBe(
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
      expect(result.categories?.["source"]?.model).toBe("opencode/kimi-k2.5-free")
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

    test("should set zion to opencode-go/deepseek-v4-flash (automation tier)", () => {
      //#given
      //#when
      const result = expandProfile("go")

      //#then
      expect(result.agents?.zion?.model).toBe("opencode-go/deepseek-v4-flash")
    })

    test("should set source category to opencode-go/kimi-k2.6", () => {
      //#given
      //#when
      const result = expandProfile("go")

      //#then
      expect(result.categories?.["source"]?.model).toBe("opencode-go/kimi-k2.6")
    })

    test("should set bullet-time category to opencode-go/deepseek-v4-flash", () => {
      //#given
      //#when
      const result = expandProfile("go")

      //#then
      expect(result.categories?.["bullet-time"]?.model).toBe("opencode-go/deepseek-v4-flash")
    })
  })

  describe("PROFILE_NAMES", () => {
    test("should export all six profile names", () => {
      //#given
      //#when
      //#then
      expect(PROFILE_NAMES).toContain("free")
      expect(PROFILE_NAMES).toContain("budget")
      expect(PROFILE_NAMES).toContain("economy")
      expect(PROFILE_NAMES).toContain("balanced")
      expect(PROFILE_NAMES).toContain("performance")
      expect(PROFILE_NAMES).toContain("go")
      expect(PROFILE_NAMES).toHaveLength(6)
    })
  })
})
