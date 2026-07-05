import { describe, it, expect, afterEach } from "bun:test"
import { AGENT_DISPLAY_NAMES, getAgentConfigKey, getAgentDisplayName, getAgentListDisplayName, normalizeAgentForPrompt, normalizeAgentForPromptKey, stripAgentListSortPrefix, setOverrideDisplayNames, _resetOverrideDisplayNamesForTesting } from "./agent-display-names"

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

describe("reverse override lookup (setOverrideDisplayNames)", () => {
  afterEach(() => {
    _resetOverrideDisplayNamesForTesting()
  })

  it("getAgentConfigKey resolves custom display name override back to config key", () => {
    // given a custom displayName override for sisyphus
    setOverrideDisplayNames({ sisyphus: { displayName: "总指挥" } })

    // when getAgentConfigKey called with the custom display name
    // then returns "sisyphus" not "总指挥"
    expect(getAgentConfigKey("总指挥")).toBe("sisyphus")
  })

  it("getAgentConfigKey resolves custom display name case-insensitively", () => {
    setOverrideDisplayNames({ atlas: { displayName: "アトラス" } })

    expect(getAgentConfigKey("アトラス")).toBe("atlas")
  })

  it("getAgentConfigKey resolves CJK override for hephaestus", () => {
    setOverrideDisplayNames({ hephaestus: { displayName: "헤파이스토스" } })

    expect(getAgentConfigKey("헤파이스토스")).toBe("hephaestus")
  })

  it("getAgentConfigKey resolves multiple overrides simultaneously", () => {
    setOverrideDisplayNames({
      sisyphus: { displayName: "总指挥" },
      atlas: { displayName: "アトラス" },
      hephaestus: { displayName: "헤파이스토스" },
    })

    expect(getAgentConfigKey("总指挥")).toBe("sisyphus")
    expect(getAgentConfigKey("アトラス")).toBe("atlas")
    expect(getAgentConfigKey("헤파이스토스")).toBe("hephaestus")
  })

  it("override takes precedence over hardcoded display names", () => {
    // given override that replaces the default display name
    setOverrideDisplayNames({ sisyphus: { displayName: "Boss" } })

    // the old hardcoded name should no longer resolve (override replaces it)
    // but the config key itself still works
    expect(getAgentConfigKey("Boss")).toBe("sisyphus")
    expect(getAgentConfigKey("sisyphus")).toBe("sisyphus")
  })

  it("hardcoded display names still work after override is set for a different agent", () => {
    setOverrideDisplayNames({ sisyphus: { displayName: "总指挥" } })

    // atlas hardcoded name should still resolve
    expect(getAgentConfigKey("Atlas - Plan Executor")).toBe("atlas")
  })

  it("normalizeAgentForPrompt resolves override display name to canonical display name", () => {
    setOverrideDisplayNames({ sisyphus: { displayName: "总指挥" } })

    // normalizeAgentForPrompt should return the override display name
    expect(normalizeAgentForPrompt("总指挥")).toBe("总指挥")
  })

  it("normalizeAgentForPromptKey resolves override display name to config key", () => {
    setOverrideDisplayNames({ atlas: { displayName: "アトラス" } })

    expect(normalizeAgentForPromptKey("アトラス")).toBe("atlas")
  })

  it("returns lowercased unknown name after reset when override was removed", () => {
    // given override set then reset
    setOverrideDisplayNames({ sisyphus: { displayName: "总指挥" } })
    _resetOverrideDisplayNamesForTesting()

    // when getAgentConfigKey called with the old override name
    // then returns lowercased unknown (no longer recognized)
    expect(getAgentConfigKey("总指挥")).toBe("总指挥")
  })

  it("setOverrideDisplayNames with undefined or empty overrides is a no-op", () => {
    setOverrideDisplayNames(undefined)
    setOverrideDisplayNames({})

    // hardcoded names still work
    expect(getAgentConfigKey("Sisyphus - ultraworker")).toBe("sisyphus")
  })

  it("agents without displayName override fall back to hardcoded lookup", () => {
    // given overrides map where sisyphus has no displayName
    setOverrideDisplayNames({ sisyphus: { }, atlas: { displayName: "アトラス" } })

    // sisyphus hardcoded name still resolves
    expect(getAgentConfigKey("Sisyphus - ultraworker")).toBe("sisyphus")
    // atlas override resolves
    expect(getAgentConfigKey("アトラス")).toBe("atlas")
  })

  it("normalizeAgentForPrompt resolves config key to override display name", () => {
    // given override set for sisyphus
    setOverrideDisplayNames({ sisyphus: { displayName: "总指挥" } })

    // when normalizeAgentForPrompt called with the config key "sisyphus"
    // then returns the override display name, not the hardcoded one
    expect(normalizeAgentForPrompt("sisyphus")).toBe("总指挥")
  })

  it("normalizeAgentForPrompt resolves uppercase config key to override display name", () => {
    setOverrideDisplayNames({ atlas: { displayName: "アトラス" } })

    // uppercase config key should still resolve to override name
    expect(normalizeAgentForPrompt("Atlas")).toBe("アトラス")
  })

  it("resolves legacy config keys in overrides to canonical config keys", () => {
    // given override with legacy key "omo"
    setOverrideDisplayNames({ omo: { displayName: "总指挥" } })

    // then getAgentConfigKey resolves "总指挥" to "sisyphus"
    expect(getAgentConfigKey("总指挥")).toBe("sisyphus")

    // and normalizeAgentForPrompt resolves legacy key "omo" to override display name "总指挥"
    expect(normalizeAgentForPrompt("omo")).toBe("总指挥")
    expect(normalizeAgentForPrompt("sisyphus")).toBe("总指挥")
    expect(normalizeAgentForPromptKey("总指挥")).toBe("sisyphus")
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
