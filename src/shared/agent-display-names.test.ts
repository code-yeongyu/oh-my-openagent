import { describe, it, expect } from "bun:test"
import { AGENT_DISPLAY_NAMES, getAgentConfigKey, getAgentDisplayName, getAgentListDisplayName, normalizeAgentForPrompt, normalizeAgentForPromptKey } from "./agent-display-names"

describe("getAgentDisplayName", () => {
  it("returns display name for lowercase config key (new format)", () => {
    // given config key "sisyphus"
    const configKey = "sisyphus"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns "Sisyphus - Ultraworker"
    expect(result).toBe("Sisyphus - Ultraworker")
  })

  it("returns display name for uppercase config key (old format - case-insensitive)", () => {
    // given config key "Sisyphus" (old format)
    const configKey = "Sisyphus"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns "Sisyphus - Ultraworker" (case-insensitive lookup)
    expect(result).toBe("Sisyphus - Ultraworker")
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
})

describe("getAgentConfigKey", () => {
  it("resolves display name to config key", () => {
    // given display name "Sisyphus - Ultraworker"
    // when getAgentConfigKey called
    // then returns "sisyphus"
    expect(getAgentConfigKey("Sisyphus - Ultraworker")).toBe("sisyphus")
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

  it("resolves atlas even when a legacy ZWSP sort prefix is present on the stored key", () => {
    // Users who installed v3.14.0 through v3.16.0 may have ZWSP-prefixed agent
    // names baked into their config.agent keys. The resolver must still find
    // the canonical config key after strip.
    expect(getAgentConfigKey("\u200B\u200B\u200B\u200BAtlas - Plan Executor")).toBe("atlas")
  })
})

describe("getAgentListDisplayName (deprecated alias, GH-3259)", () => {
  it("returns plain display names without the legacy ZWSP sort prefix", () => {
    // ZWSP prefixes were removed in #3242/#3259. This alias is retained for
    // external callers that may still import it, but it now behaves
    // identically to getAgentDisplayName.
    expect(getAgentListDisplayName("sisyphus")).toBe("Sisyphus - Ultraworker")
    expect(getAgentListDisplayName("hephaestus")).toBe("Hephaestus - Deep Agent")
    expect(getAgentListDisplayName("prometheus")).toBe("Prometheus - Plan Builder")
    expect(getAgentListDisplayName("atlas")).toBe("Atlas - Plan Executor")
  })

  it("matches getAgentDisplayName for unknown agents", () => {
    expect(getAgentListDisplayName("oracle")).toBe("oracle")
  })

  it("contains no zero-width characters in any core agent output (GH-3259)", () => {
    const coreAgents = ["sisyphus", "hephaestus", "prometheus", "atlas"]
    for (const agent of coreAgents) {
      const result = getAgentListDisplayName(agent)
      expect(result).not.toMatch(/[\u200B\u200C\u200D\uFEFF]/)
    }
  })
})

describe("normalizeAgentForPrompt", () => {
  it("strips legacy ZWSP sort prefixes from stored agent keys back to canonical display names", () => {
    // Configs from v3.14.0-v3.16.0 may persist ZWSP-prefixed keys. The
    // normalizer must restore the canonical name on read.
    expect(normalizeAgentForPrompt("\u200BSisyphus - Ultraworker")).toBe("Sisyphus - Ultraworker")
    expect(normalizeAgentForPrompt("\u200B\u200BHephaestus - Deep Agent")).toBe("Hephaestus - Deep Agent")
    expect(normalizeAgentForPrompt("\u200B\u200B\u200BPrometheus - Plan Builder")).toBe("Prometheus - Plan Builder")
    expect(normalizeAgentForPrompt("\u200B\u200B\u200B\u200BAtlas - Plan Executor")).toBe("Atlas - Plan Executor")
  })
})

describe("normalizeAgentForPromptKey", () => {
  it("converts built-in display names to config keys", () => {
    expect(normalizeAgentForPromptKey("Sisyphus (Ultraworker)")).toBe("sisyphus")
  })

  it("preserves custom agents", () => {
    expect(normalizeAgentForPromptKey("MyCustomAgent")).toBe("MyCustomAgent")
  })
})

describe("AGENT_DISPLAY_NAMES", () => {
  it("contains all expected agent mappings", () => {
    // given expected mappings
    const expectedMappings = {
      sisyphus: "Sisyphus - Ultraworker",
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
    for (const [key, displayName] of Object.entries(AGENT_DISPLAY_NAMES)) {
      // then none should contain parentheses
      expect(httpHeaderUnsafe.test(displayName)).toBe(false)
    }
  })
})
