import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import {
  AGENT_DISPLAY_NAMES,
  getAgentDisplayName,
  getAgentConfigKey,
  applyUserDisplayNames,
  resetUserDisplayNames,
} from "./agent-display-names"

describe("getAgentDisplayName", () => {
  it("returns display name for lowercase config key (new format)", () => {
    // given config key "sisyphus"
    const configKey = "sisyphus"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns "Sisyphus (Ultraworker)"
    expect(result).toBe("Sisyphus (Ultraworker)")
  })

  it("returns display name for uppercase config key (old format - case-insensitive)", () => {
    // given config key "Sisyphus" (old format)
    const configKey = "Sisyphus"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns "Sisyphus (Ultraworker)" (case-insensitive lookup)
    expect(result).toBe("Sisyphus (Ultraworker)")
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

     // then returns "Atlas (Plan Executor)"
    expect(result).toBe("Atlas (Plan Executor)")
  })

  it("returns display name for prometheus", () => {
    // given config key "prometheus"
    const configKey = "prometheus"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns "Prometheus (Plan Builder)"
    expect(result).toBe("Prometheus (Plan Builder)")
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

    // then returns "Metis (Plan Consultant)"
    expect(result).toBe("Metis (Plan Consultant)")
  })

  it("returns display name for momus", () => {
    // given config key "momus"
    const configKey = "momus"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

     // then returns "Momus (Plan Critic)"
    expect(result).toBe("Momus (Plan Critic)")
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
    // given display name "Sisyphus (Ultraworker)"
    // when getAgentConfigKey called
    // then returns "sisyphus"
    expect(getAgentConfigKey("Sisyphus (Ultraworker)")).toBe("sisyphus")
  })

  it("resolves display name case-insensitively", () => {
    // given display name in different case
    // when getAgentConfigKey called
    // then returns "atlas"
    expect(getAgentConfigKey("atlas (plan executor)")).toBe("atlas")
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
    expect(getAgentConfigKey("Hephaestus (Deep Agent)")).toBe("hephaestus")
    expect(getAgentConfigKey("Prometheus (Plan Builder)")).toBe("prometheus")
    expect(getAgentConfigKey("Atlas (Plan Executor)")).toBe("atlas")
    expect(getAgentConfigKey("Metis (Plan Consultant)")).toBe("metis")
    expect(getAgentConfigKey("Momus (Plan Critic)")).toBe("momus")
    expect(getAgentConfigKey("Sisyphus-Junior")).toBe("sisyphus-junior")
  })
})

describe("AGENT_DISPLAY_NAMES", () => {
  it("contains all expected agent mappings", () => {
    // given expected mappings
    const expectedMappings = {
      sisyphus: "Sisyphus (Ultraworker)",
      hephaestus: "Hephaestus (Deep Agent)",
      prometheus: "Prometheus (Plan Builder)",
      atlas: "Atlas (Plan Executor)",
      "sisyphus-junior": "Sisyphus-Junior",
      metis: "Metis (Plan Consultant)",
      momus: "Momus (Plan Critic)",
      oracle: "oracle",
      librarian: "librarian",
      explore: "explore",
      "multimodal-looker": "multimodal-looker",
    }

    // when checking the constant
    // then contains all expected mappings
    expect(AGENT_DISPLAY_NAMES).toEqual(expectedMappings)
  })
})

describe("#given user-defined display name overrides via config", () => {
  beforeEach(() => {
    resetUserDisplayNames()
  })

  afterEach(() => {
    resetUserDisplayNames()
  })

  describe("#when getAgentDisplayName called", () => {
    it("#then returns user override instead of built-in default", () => {
      applyUserDisplayNames({ sisyphus: "Builder" })
      expect(getAgentDisplayName("sisyphus")).toBe("Builder")
    })

    it("#then handles case-insensitive config keys", () => {
      applyUserDisplayNames({ Sisyphus: "Builder" })
      expect(getAgentDisplayName("sisyphus")).toBe("Builder")
    })

    it("#then returns default display name for agents without overrides", () => {
      applyUserDisplayNames({ sisyphus: "Builder" })
      expect(getAgentDisplayName("oracle")).toBe("oracle")
      expect(getAgentDisplayName("atlas")).toBe("Atlas (Plan Executor)")
    })

    it("#then overrides identity-mapped agents (display name === config key)", () => {
      applyUserDisplayNames({ oracle: "Wise One" })
      expect(getAgentDisplayName("oracle")).toBe("Wise One")
    })

    it("#then applies multiple overrides simultaneously", () => {
      applyUserDisplayNames({
        sisyphus: "Builder",
        oracle: "Wise One",
        prometheus: "Plan Master",
      })
      expect(getAgentDisplayName("sisyphus")).toBe("Builder")
      expect(getAgentDisplayName("oracle")).toBe("Wise One")
      expect(getAgentDisplayName("prometheus")).toBe("Plan Master")
    })

    it("#then treats empty overrides object as no-op", () => {
      applyUserDisplayNames({})
      expect(getAgentDisplayName("sisyphus")).toBe("Sisyphus (Ultraworker)")
      expect(getAgentDisplayName("oracle")).toBe("oracle")
    })
  })

  describe("#when getAgentConfigKey called", () => {
    it("#then resolves user override display name back to config key", () => {
      applyUserDisplayNames({ sisyphus: "Builder" })
      expect(getAgentConfigKey("Builder")).toBe("sisyphus")
    })

    it("#then resolves user override case-insensitively", () => {
      applyUserDisplayNames({ sisyphus: "Builder" })
      expect(getAgentConfigKey("builder")).toBe("sisyphus")
    })

    it("#then still resolves built-in display names when overrides are active", () => {
      applyUserDisplayNames({ sisyphus: "Builder" })
      expect(getAgentConfigKey("Hephaestus (Deep Agent)")).toBe("hephaestus")
      expect(getAgentConfigKey("Atlas (Plan Executor)")).toBe("atlas")
    })

    it("#then resolves overridden identity-mapped agent", () => {
      applyUserDisplayNames({ oracle: "Wise One" })
      expect(getAgentConfigKey("Wise One")).toBe("oracle")
    })

    it("#then resolves multiple overrides back to config keys", () => {
      applyUserDisplayNames({
        sisyphus: "Builder",
        oracle: "Wise One",
        prometheus: "Plan Master",
      })
      expect(getAgentConfigKey("Builder")).toBe("sisyphus")
      expect(getAgentConfigKey("Wise One")).toBe("oracle")
      expect(getAgentConfigKey("Plan Master")).toBe("prometheus")
    })
  })

  describe("#when resetUserDisplayNames called", () => {
    it("#then restores built-in display names", () => {
      applyUserDisplayNames({ sisyphus: "Builder" })
      expect(getAgentDisplayName("sisyphus")).toBe("Builder")

      resetUserDisplayNames()
      expect(getAgentDisplayName("sisyphus")).toBe("Sisyphus (Ultraworker)")
    })

    it("#then restores built-in reverse lookups", () => {
      applyUserDisplayNames({ sisyphus: "Builder" })
      expect(getAgentConfigKey("Builder")).toBe("sisyphus")

      resetUserDisplayNames()
      expect(getAgentConfigKey("Builder")).toBe("builder")
      expect(getAgentConfigKey("Sisyphus (Ultraworker)")).toBe("sisyphus")
    })
  })

  describe("#when AGENT_DISPLAY_NAMES constant accessed directly", () => {
    it("#then remains unchanged by user overrides", () => {
      applyUserDisplayNames({ sisyphus: "Builder" })
      expect(AGENT_DISPLAY_NAMES.sisyphus).toBe("Sisyphus (Ultraworker)")
      expect(AGENT_DISPLAY_NAMES.oracle).toBe("oracle")
    })
  })
})