import { describe, it, expect } from "bun:test"
import { AGENT_DISPLAY_NAMES, getAgentDisplayName } from "./agent-display-names"

describe("getAgentDisplayName", () => {
  it("returns display name for lowercase config key (new format)", () => {
    // #given config key "sisyphus"
    const configKey = "sisyphus"

    // #when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // #then returns "Sisyphus (Ultraworker)"
    expect(result).toBe("Sisyphus (Ultraworker)")
  })

  it("returns display name for uppercase config key (old format - case-insensitive)", () => {
    // #given config key "Sisyphus" (old format)
    const configKey = "Sisyphus"

    // #when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // #then returns "Sisyphus (Ultraworker)" (case-insensitive lookup)
    expect(result).toBe("Sisyphus (Ultraworker)")
  })

  it("returns original key for unknown agents (fallback)", () => {
    // #given config key "custom-agent"
    const configKey = "custom-agent"

    // #when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // #then returns "custom-agent" (original key unchanged)
    expect(result).toBe("custom-agent")
  })

  it("returns display name for atlas", () => {
    // #given config key "atlas"
    const configKey = "atlas"

    // #when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // #then returns "Atlas (Plan Execution Orchestrator)"
    expect(result).toBe("Atlas (Plan Execution Orchestrator)")
  })

  it("returns display name for prometheus", () => {
    // #given config key "prometheus"
    const configKey = "prometheus"

    // #when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // #then returns "Prometheus (Plan Builder)"
    expect(result).toBe("Prometheus (Plan Builder)")
  })

  it("returns display name for sisyphus-junior", () => {
    // #given config key "sisyphus-junior"
    const configKey = "sisyphus-junior"

    // #when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // #then returns "Sisyphus-Junior"
    expect(result).toBe("Sisyphus-Junior")
  })

  it("returns display name for metis", () => {
    // #given config key "metis"
    const configKey = "metis"

    // #when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // #then returns "Metis (Plan Consultant)"
    expect(result).toBe("Metis (Plan Consultant)")
  })

  it("returns display name for momus", () => {
    // #given config key "momus"
    const configKey = "momus"

    // #when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // #then returns "Momus (Plan Reviewer)"
    expect(result).toBe("Momus (Plan Reviewer)")
  })

  it("returns display name for oracle", () => {
    // #given config key "oracle"
    const configKey = "oracle"

    // #when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // #then returns "oracle"
    expect(result).toBe("oracle")
  })

  it("returns display name for librarian", () => {
    // #given config key "librarian"
    const configKey = "librarian"

    // #when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // #then returns "librarian"
    expect(result).toBe("librarian")
  })

  it("returns display name for explore", () => {
    // #given config key "explore"
    const configKey = "explore"

    // #when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // #then returns "explore"
    expect(result).toBe("explore")
  })

  it("returns display name for multimodal-looker", () => {
    // #given config key "multimodal-looker"
    const configKey = "multimodal-looker"

    // #when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // #then returns "multimodal-looker"
    expect(result).toBe("multimodal-looker")
  })
})

describe("AGENT_DISPLAY_NAMES", () => {
  it("contains all expected agent mappings", () => {
    // #given expected mappings
    const expectedMappings = {
      sisyphus: "Sisyphus (Ultraworker)",
      atlas: "Atlas (Plan Execution Orchestrator)",
      prometheus: "Prometheus (Plan Builder)",
      "sisyphus-junior": "Sisyphus-Junior",
      metis: "Metis (Plan Consultant)",
      momus: "Momus (Plan Reviewer)",
      oracle: "oracle",
      librarian: "librarian",
      explore: "explore",
      "multimodal-looker": "multimodal-looker",
    }

    // #when checking the constant
    // #then contains all expected mappings
    expect(AGENT_DISPLAY_NAMES).toEqual(expectedMappings)
  })
})