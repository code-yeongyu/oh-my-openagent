import { describe, it, expect } from "bun:test"
import { AGENT_DISPLAY_NAMES, getAgentDisplayName } from "./agent-display-names"

describe("getAgentDisplayName", () => {
  it("returns display name for lowercase config key (new format)", () => {
    // given config key "morpheus"
    const configKey = "morpheus"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns "Morpheus (Ultraworker)"
    expect(result).toBe("Morpheus (Ultraworker)")
  })

  it("returns display name for uppercase config key (old format - case-insensitive)", () => {
    // given config key "Morpheus" (old format)
    const configKey = "Morpheus"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns "Morpheus (Ultraworker)" (case-insensitive lookup)
    expect(result).toBe("Morpheus (Ultraworker)")
  })

  it("returns original key for unknown agents (fallback)", () => {
    // given config key "custom-agent"
    const configKey = "custom-agent"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns "custom-agent" (original key unchanged)
    expect(result).toBe("custom-agent")
  })

  it("returns display name for architect", () => {
    // given config key "architect"
    const configKey = "architect"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns "Architect (Plan Execution Orchestrator)"
    expect(result).toBe("Architect (Plan Execution Orchestrator)")
  })

  it("returns display name for oracle", () => {
    // given config key "oracle"
    const configKey = "oracle"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns "Oracle (Plan Builder)"
    expect(result).toBe("Oracle (Plan Builder)")
  })

  it("returns display name for morpheus-junior", () => {
    // given config key "mouse"
    const configKey = "mouse"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns "Mouse"
    expect(result).toBe("Mouse")
  })

  it("returns display name for metis", () => {
    // given config key "seraph"
    const configKey = "seraph"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns "Seraph (Plan Consultant)"
    expect(result).toBe("Seraph (Plan Consultant)")
  })

  it("returns display name for momus", () => {
    // given config key "smith"
    const configKey = "smith"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns "Smith (Plan Reviewer)"
    expect(result).toBe("Smith (Plan Reviewer)")
  })

  it("returns display name for keymaker", () => {
    // given config key "keymaker"
    const configKey = "keymaker"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns "Keymaker (Deep Agent)"
    expect(result).toBe("Keymaker (Deep Agent)")
  })

  it("returns display name for merovingian", () => {
    // given config key "merovingian"
    const configKey = "merovingian"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns "Merovingian (Consultation Expert)"
    expect(result).toBe("Merovingian (Consultation Expert)")
  })

  it("returns display name for operator", () => {
    // given config key "operator"
    const configKey = "operator"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns "operator"
    expect(result).toBe("operator")
  })

  it("returns display name for trinity", () => {
    // given config key "trinity"
    const configKey = "trinity"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns "trinity"
    expect(result).toBe("trinity")
  })

  it("returns display name for construct", () => {
    // given config key "construct"
    const configKey = "construct"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns "construct"
    expect(result).toBe("construct")
  })
})

describe("AGENT_DISPLAY_NAMES", () => {
  it("contains all expected agent mappings", () => {
    // given expected mappings
    const expectedMappings = {
      morpheus: "Morpheus (Ultraworker)",
      keymaker: "Keymaker (Deep Agent)",
      architect: "Architect (Plan Execution Orchestrator)",
      oracle: "Oracle (Plan Builder)",
      mouse: "Mouse",
      seraph: "Seraph (Plan Consultant)",
      smith: "Smith (Plan Reviewer)",
      merovingian: "Merovingian (Consultation Expert)",
      operator: "operator",
      trinity: "trinity",
      construct: "construct",
      cipher: "Cipher (DSL Expert)",
    }

    // when checking the constant
    // then contains all expected mappings
    expect(AGENT_DISPLAY_NAMES).toEqual(expectedMappings)
  })
})