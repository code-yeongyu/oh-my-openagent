import { describe, it, expect } from "bun:test"
import { AGENT_DISPLAY_NAMES, getAgentConfigKey, getAgentDisplayName, getAgentListDisplayName, normalizeAgentForPrompt, normalizeAgentForPromptKey, sanitizeAgentNameForDisplay, stripAgentListSortPrefix } from "./agent-display-names"

describe("getAgentDisplayName", () => {
  it("returns display name for lowercase config key (new format)", () => {
    // given config key "sisyphus"
    const configKey = "sisyphus"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns "Sisyphus - ultraworker"
    expect(result).toBe("Sisyphus - ultraworker")
  })

  it("returns display name for uppercase config key (old format - case-insensitive)", () => {
    // given config key "Sisyphus" (old format)
    const configKey = "Sisyphus"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns "Sisyphus - ultraworker" (case-insensitive lookup)
    expect(result).toBe("Sisyphus - ultraworker")
  })

  it("returns original key for unknown agents (fallback)", () => {
    // given config key "custom-agent"
    const configKey = "custom-agent"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns "custom-agent" (original key unchanged)
    expect(result).toBe("custom-agent")
  })

  it("returns display name for atlas", () => {
    // given config key "atlas"
    const configKey = "atlas"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

     // then returns "Atlas - Plan Executor"
    expect(result).toBe("Atlas - Plan Executor")
  })

  it("returns display name for prometheus", () => {
    // given config key "prometheus"
    const configKey = "prometheus"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns "Prometheus - Plan Builder"
    expect(result).toBe("Prometheus - Plan Builder")
  })

  it("returns display name for sisyphus-junior", () => {
    // given config key "sisyphus-junior"
    const configKey = "sisyphus-junior"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns "Sisyphus-Junior"
    expect(result).toBe("Sisyphus-Junior")
  })

  it("returns display name for metis", () => {
    // given config key "metis"
    const configKey = "metis"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns "Metis - Plan Consultant"
    expect(result).toBe("Metis - Plan Consultant")
  })

  it("returns display name for momus", () => {
    // given config key "momus"
    const configKey = "momus"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

     // then returns "Momus - Plan Critic"
    expect(result).toBe("Momus - Plan Critic")
  })

  it("returns display name for oracle", () => {
    // given config key "oracle"
    const configKey = "oracle"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns "oracle"
    expect(result).toBe("oracle")
  })

  it("returns display name for librarian", () => {
    // given config key "librarian"
    const configKey = "librarian"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns "librarian"
    expect(result).toBe("librarian")
  })

  it("returns display name for explore", () => {
    // given config key "explore"
    const configKey = "explore"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns "explore"
    expect(result).toBe("explore")
  })

  it("returns display name for multimodal-looker", () => {
    // given config key "multimodal-looker"
    const configKey = "multimodal-looker"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns "multimodal-looker"
    expect(result).toBe("multimodal-looker")
  })

  it("preserves CJK display-name overrides verbatim", () => {
    expect(getAgentDisplayName("sisyphus", { sisyphus: { displayName: "Sisyphus - 主脑" } })).toBe("Sisyphus - 主脑")
    expect(getAgentDisplayName("hephaestus", { hephaestus: { displayName: "헤파이스토스" } })).toBe("헤파이스토스")
    expect(getAgentDisplayName("atlas", { atlas: { displayName: "アトラス" } })).toBe("アトラス")
  })
})

describe("getAgentConfigKey", () => {
  it("resolves display name to config key", () => {
    // given display name "Sisyphus - ultraworker"
    // when getAgentConfigKey called
    // then returns "sisyphus"
    expect(getAgentConfigKey("Sisyphus - ultraworker")).toBe("sisyphus")
  })

  it("resolves display name case-insensitively", () => {
    // given display name in different case
    // when getAgentConfigKey called
    // then returns "atlas"
    expect(getAgentConfigKey("atlas - plan executor")).toBe("atlas")
  })

  it("resolves legacy parenthesized display names", () => {
    // given legacy parenthesized display name from old configs/sessions
    // when getAgentConfigKey called
    // then resolves to canonical config key
    expect(getAgentConfigKey("Sisyphus (Ultraworker)")).toBe("sisyphus")
    expect(getAgentConfigKey("Atlas (Plan Executor)")).toBe("atlas")
  })

  it("passes through lowercase config keys unchanged", () => {
    // given lowercase config key "prometheus"
    // when getAgentConfigKey called
    // then returns "prometheus"
    expect(getAgentConfigKey("prometheus")).toBe("prometheus")
  })

  it("returns lowercased unknown agents", () => {
    // given unknown agent name
    // when getAgentConfigKey called
    // then returns lowercased
    expect(getAgentConfigKey("Custom-Agent")).toBe("custom-agent")
  })

  it("resolves all core agent display names", () => {
    // given all core display names
    // when/then each resolves to its config key
    expect(getAgentConfigKey("Hephaestus - Deep Agent")).toBe("hephaestus")
    expect(getAgentConfigKey("Prometheus - Plan Builder")).toBe("prometheus")
    expect(getAgentConfigKey("Atlas - Plan Executor")).toBe("atlas")
    expect(getAgentConfigKey("Metis - Plan Consultant")).toBe("metis")
    expect(getAgentConfigKey("Momus - Plan Critic")).toBe("momus")
    expect(getAgentConfigKey("Sisyphus-Junior")).toBe("sisyphus-junior")
  })

  it("resolves atlas even when the UI ordering prefix is present", () => {
    expect(getAgentConfigKey(getAgentListDisplayName("atlas"))).toBe("atlas")
  })

  it("resolves display names even when zero-width characters are embedded", () => {
    expect(getAgentConfigKey("Sisyphus\u200B - Ultraworker")).toBe("sisyphus")
    expect(getAgentConfigKey("\uFEFFAtlas - Plan Executor")).toBe("atlas")
  })
})

describe("getAgentListDisplayName", () => {
  it("returns the canonical display name for the core agent list", () => {
    expect(getAgentListDisplayName("sisyphus")).toBe("Sisyphus - ultraworker")
    expect(getAgentListDisplayName("hephaestus")).toBe("Hephaestus - Deep Agent")
    expect(getAgentListDisplayName("prometheus")).toBe("Prometheus - Plan Builder")
    expect(getAgentListDisplayName("atlas")).toBe("Atlas - Plan Executor")
  })

  it("keeps non-core agents unchanged for list display", () => {
    expect(getAgentListDisplayName("oracle")).toBe("oracle")
  })

  it("is a thin alias for getAgentDisplayName", () => {
    expect(getAgentListDisplayName("sisyphus")).toBe(getAgentDisplayName("sisyphus"))
  })
})

describe("stripAgentListSortPrefix", () => {
  it("strips legacy zero-width sort prefixes baked into v3.14.0–v3.16.0 sessions", () => {
    expect(stripAgentListSortPrefix("\u200B\u200BHephaestus - Deep Agent")).toBe("Hephaestus - Deep Agent")
  })

  it("strips leading and trailing wrapper characters after sort prefix removal", () => {
    expect(stripAgentListSortPrefix("\\Hephaestus - Deep Agent\\")).toBe("Hephaestus - Deep Agent")
  })
})

describe("normalizeAgentForPrompt", () => {
  it("strips core UI ordering prefixes back to canonical display names", () => {
    expect(normalizeAgentForPrompt(getAgentListDisplayName("sisyphus"))).toBe("Sisyphus - ultraworker")
    expect(normalizeAgentForPrompt(getAgentListDisplayName("hephaestus"))).toBe("Hephaestus - Deep Agent")
    expect(normalizeAgentForPrompt(getAgentListDisplayName("prometheus"))).toBe("Prometheus - Plan Builder")
    expect(normalizeAgentForPrompt(getAgentListDisplayName("atlas"))).toBe("Atlas - Plan Executor")
  })

  it("removes zero-width characters before returning canonical names", () => {
    expect(normalizeAgentForPrompt("Sisyphus\u200B - Ultraworker")).toBe("Sisyphus - ultraworker")
  })

  it("converts legacy parenthesized names to canonical display names", () => {
    expect(normalizeAgentForPrompt("Atlas (Plan Executor)")).toBe("Atlas - Plan Executor")
  })
})

describe("normalizeAgentForPromptKey", () => {
  it("converts built-in display names to config keys", () => {
    expect(normalizeAgentForPromptKey("Sisyphus (Ultraworker)")).toBe("sisyphus")
  })

  it("strips UI ordering prefixes before returning config keys", () => {
    expect(normalizeAgentForPromptKey(getAgentListDisplayName("atlas"))).toBe("atlas")
  })

  it("preserves custom agents", () => {
    expect(normalizeAgentForPromptKey("MyCustomAgent")).toBe("MyCustomAgent")
  })
})

describe("AGENT_DISPLAY_NAMES", () => {
  it("contains all expected agent mappings", () => {
    // given expected mappings
    const expectedMappings = {
      sisyphus: "Sisyphus - ultraworker",
      hephaestus: "Hephaestus - Deep Agent",
      prometheus: "Prometheus - Plan Builder",
      atlas: "Atlas - Plan Executor",
      "sisyphus-junior": "Sisyphus-Junior",
      metis: "Metis - Plan Consultant",
      momus: "Momus - Plan Critic",
      athena: "Athena - Council",
      "athena-junior": "Athena-Junior - Council",
      oracle: "oracle",
      librarian: "librarian",
      explore: "explore",
      "multimodal-looker": "multimodal-looker",
      "council-member": "council-member",
    }

    // when checking the constant
    // then contains all expected mappings
    expect(AGENT_DISPLAY_NAMES).toEqual(expectedMappings)
  })

  it("all display names must be HTTP-header-safe (no parentheses)", () => {
    // given all agent display names
    const httpHeaderUnsafe = /[()]/

    // when checking each display name
    for (const [, displayName] of Object.entries(AGENT_DISPLAY_NAMES)) {
      // then none should contain parentheses
      expect(httpHeaderUnsafe.test(displayName)).toBe(false)
    }
  })
})

describe("sanitizeAgentNameForDisplay", () => {
  it("strips U+200B from a single-prefix name and returns the clean display name", () => {
    // given a name with a single leading ZWSP prefix
    const input = "\u200BSisyphus - Ultraworker"

    // when sanitized for display
    const result = sanitizeAgentNameForDisplay(input)

    // then the invisible prefix is gone
    expect(result).toBe("Sisyphus - Ultraworker")
  })

  it("strips all four invisible codepoints (U+200B, U+200C, U+200D, U+FEFF)", () => {
    // given a name with all four invisible codepoints prepended
    const input = "\u200B\u200C\u200D\uFEFFAtlas - Plan Executor"

    // when sanitized for display
    const result = sanitizeAgentNameForDisplay(input)

    // then every invisible codepoint is removed
    expect(result).toBe("Atlas - Plan Executor")
  })

  it("passes clean names through unchanged", () => {
    // given a name with no invisible codepoints
    const input = "Hephaestus - Deep Agent"

    // when sanitized for display
    const result = sanitizeAgentNameForDisplay(input)

    // then the input is returned unchanged
    expect(result).toBe("Hephaestus - Deep Agent")
  })

  it("is idempotent (sanitize(sanitize(x)) === sanitize(x))", () => {
    // given a name with repeated invisible prefixes
    const input = "\u200B\u200BPrometheus - Plan Builder"

    // when sanitized once and then again
    const once = sanitizeAgentNameForDisplay(input)
    const twice = sanitizeAgentNameForDisplay(once)

    // then both results match and contain no invisible codepoints
    expect(once).toBe(twice)
    expect(/[\u200B\u200C\u200D\uFEFF]/.test(once)).toBe(false)
  })

  it("returns empty string for empty string input", () => {
    // given an empty string
    const input = ""

    // when sanitized for display
    const result = sanitizeAgentNameForDisplay(input)

    // then the empty string is returned
    expect(result).toBe("")
  })

  it("returns empty string for a string made up entirely of invisible codepoints", () => {
    // given a string containing only invisible codepoints
    const input = "\u200B\u200C\u200D\uFEFF"

    // when sanitized for display
    const result = sanitizeAgentNameForDisplay(input)

    // then the entire string is stripped away
    expect(result).toBe("")
  })

  it("handles a long string with invisible codepoints scattered throughout", () => {
    // given visible characters interleaved with invisible codepoints
    const input = "a\u200Bb\u200Cc\u200Dd\uFEFFe\u200Bf"

    // when sanitized for display
    const result = sanitizeAgentNameForDisplay(input)

    // then only the visible characters remain in order
    expect(result).toBe("abcdef")
  })

  it("cleans a legacy display name with a ZWSP embedded mid-word", () => {
    // given a legacy name with a ZWSP embedded mid-word
    const input = "Sisyphus\u200B - Ultraworker"

    // when sanitized for display
    const result = sanitizeAgentNameForDisplay(input)

    // then the embedded ZWSP is removed
    expect(result).toBe("Sisyphus - Ultraworker")
  })
})
