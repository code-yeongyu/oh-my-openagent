import { describe, expect, it } from "bun:test"
import { normalizeMemberId, normalizeMemberName, areMemberIdsEqual } from "./member-id-normalizer"

describe("normalizeMemberId", () => {
  describe("#given mixed case member ID", () => {
    it("#then returns lowercase ID", () => {
      expect(normalizeMemberId("Claude Opus")).toBe("claude_opus")
    })
  })

  describe("#given member ID with spaces", () => {
    it("#then replaces spaces with underscores", () => {
      expect(normalizeMemberId("GPT 5.3 Codex")).toBe("gpt_5.3_codex")
    })
  })

  describe("#given member ID with multiple consecutive spaces", () => {
    it("#then collapses spaces into single underscore", () => {
      expect(normalizeMemberId("Gemini  Pro  3")).toBe("gemini_pro_3")
    })
  })

  describe("#given member ID with leading/trailing whitespace", () => {
    it("#then trims whitespace before normalization", () => {
      expect(normalizeMemberId("  Kimi 2.5  ")).toBe("kimi_2.5")
    })
  })

  describe("#given already normalized member ID", () => {
    it("#then returns unchanged", () => {
      expect(normalizeMemberId("claude_opus")).toBe("claude_opus")
    })
  })

  describe("#given member ID with special characters", () => {
    it("#then preserves alphanumeric and dots/hyphens", () => {
      expect(normalizeMemberId("Claude-3.5-Sonnet")).toBe("claude-3.5-sonnet")
    })
  })

  describe("#given empty string", () => {
    it("#then returns empty string", () => {
      expect(normalizeMemberId("")).toBe("")
    })
  })

  describe("#given member ID with tabs and newlines", () => {
    it("#then replaces all whitespace with underscores", () => {
      expect(normalizeMemberId("Claude\tOpus\nPro")).toBe("claude_opus_pro")
    })
  })
})

describe("normalizeMemberName", () => {
  describe("#given member name", () => {
    it("#then applies same normalization as normalizeMemberId", () => {
      const name = "Claude Opus"
      expect(normalizeMemberName(name)).toBe(normalizeMemberId(name))
    })
  })

  describe("#given member name with mixed case and spaces", () => {
    it("#then returns normalized name", () => {
      expect(normalizeMemberName("GPT 5.3 Codex")).toBe("gpt_5.3_codex")
    })
  })
})

describe("areMemberIdsEqual", () => {
  describe("#given identical member IDs", () => {
    it("#then returns true", () => {
      expect(areMemberIdsEqual("claude_opus", "claude_opus")).toBe(true)
    })
  })

  describe("#given member IDs that differ only in case", () => {
    it("#then returns true", () => {
      expect(areMemberIdsEqual("Claude Opus", "claude_opus")).toBe(true)
    })
  })

  describe("#given member IDs with different spacing", () => {
    it("#then returns true", () => {
      expect(areMemberIdsEqual("Claude  Opus", "Claude Opus")).toBe(true)
    })
  })

  describe("#given member IDs with leading/trailing whitespace", () => {
    it("#then returns true", () => {
      expect(areMemberIdsEqual("  Claude Opus  ", "claude_opus")).toBe(true)
    })
  })

  describe("#given different member IDs", () => {
    it("#then returns false", () => {
      expect(areMemberIdsEqual("Claude Opus", "GPT 5.3")).toBe(false)
    })
  })

  describe("#given member IDs with mixed case and spaces", () => {
    it("#then normalizes both before comparison", () => {
      expect(areMemberIdsEqual("Claude  OPUS", "claude_opus")).toBe(true)
    })
  })

  describe("#given empty strings", () => {
    it("#then returns true", () => {
      expect(areMemberIdsEqual("", "")).toBe(true)
    })
  })
})
