import { describe, it, expect } from "bun:test"
import { AGENT_DISPLAY_NAMES, getAgentConfigKey, getAgentDisplayName, getAgentListDisplayName, normalizeAgentForPrompt, normalizeAgentForPromptKey, stripAgentListSortPrefix } from "./agent-display-names"

describe("getAgentDisplayName", () => {
  it("returns display name for lowercase config key (new format)", () => {
    const configKey = "sisyphus"
    const result = getAgentDisplayName(configKey)
    expect(result).toBe("Sisyphus - ultraworker")
  })

  it("returns display name for uppercase config key (old format - case-insensitive)", () => {
    const configKey = "Sisyphus"
    const result = getAgentDisplayName(configKey)
    expect(result).toBe("Sisyphus - ultraworker")
  })

  it("returns original key for unknown agents (fallback)", () => {
    const configKey = "custom-agent"
    const result = getAgentDisplayName(configKey)
    expect(result).toBe("custom-agent")
  })

  it("returns display name for atlas", () => {
    const configKey = "atlas"
    const result = getAgentDisplayName(configKey)
    expect(result).toBe("Atlas - Plan Executor")
  })

  it("returns display name for prometheus", () => {
    const configKey = "prometheus"
    const result = getAgentDisplayName(configKey)
    expect(result).toBe("Prometheus - Plan Builder")
  })

  it("returns display name for sisyphus-junior", () => {
    const configKey = "sisyphus-junior"
    const result = getAgentDisplayName(configKey)
    expect(result).toBe("Sisyphus-Junior")
  })

  it("returns display name for metis", () => {
    const configKey = "metis"
    const result = getAgentDisplayName(configKey)
    expect(result).toBe("Metis - Plan Consultant")
  })

  it("returns display name for momus", () => {
    const configKey = "momus"
    const result = getAgentDisplayName(configKey)
    expect(result).toBe("Momus - Plan Critic")
  })

  it("returns display name for oracle", () => {
    const configKey = "oracle"
    const result = getAgentDisplayName(configKey)
    expect(result).toBe("oracle")
  })

  it("returns display name for librarian", () => {
    const configKey = "librarian"
    const result = getAgentDisplayName(configKey)
    expect(result).toBe("librarian")
  })

  it("returns display name for explore", () => {
    const configKey = "explore"
    const result = getAgentDisplayName(configKey)
    expect(result).toBe("explore")
  })

  it("returns display name for multimodal-looker", () => {
    const configKey = "multimodal-looker"
    const result = getAgentDisplayName(configKey)
    expect(result).toBe("multimodal-looker")
  })
})

describe("getAgentConfigKey", () => {
  it("resolves display name to config key", () => {
    expect(getAgentConfigKey("Sisyphus - ultraworker")).toBe("sisyphus")
  })

  it("resolves display name case-insensitively", () => {
    expect(getAgentConfigKey("atlas - plan executor")).toBe("atlas")
  })

  it("resolves legacy parenthesized display names", () => {
    expect(getAgentConfigKey("Sisyphus (Ultraworker)")).toBe("sisyphus")
    expect(getAgentConfigKey("Atlas (Plan Executor)")).toBe("atlas")
  })

  it("passes through lowercase config keys unchanged", () => {
    expect(getAgentConfigKey("prometheus")).toBe("prometheus")
  })

  it("returns lowercased unknown agents", () => {
    expect(getAgentConfigKey("Custom-Agent")).toBe("custom-agent")
  })

  it("resolves all core agent display names", () => {
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
    expect(getAgentConfigKey("Sisyphus​ - Ultraworker")).toBe("sisyphus")
    expect(getAgentConfigKey("﻿Atlas - Plan Executor")).toBe("atlas")
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
  it("strips legacy zero-width sort prefixes", () => {
    expect(stripAgentListSortPrefix("​​Hephaestus - Deep Agent")).toBe("Hephaestus - Deep Agent")
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
    expect(normalizeAgentForPrompt("Sisyphus​ - Ultraworker")).toBe("Sisyphus - ultraworker")
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
    expect(AGENT_DISPLAY_NAMES).toEqual(expectedMappings)
  })

  it("all display names must be HTTP-header-safe (no parentheses)", () => {
    const httpHeaderUnsafe = /[()]/
    for (const [, displayName] of Object.entries(AGENT_DISPLAY_NAMES)) {
      expect(httpHeaderUnsafe.test(displayName)).toBe(false)
    }
  })
})
