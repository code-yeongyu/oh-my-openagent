import { describe, test, expect } from "bun:test"
import {
  AGENT_NAME_MAP,
  HOOK_NAME_MAP,
  migrateAgentNames,
  migrateHookNames,
  migrateConfigFile,
} from "./migration"

describe("migrateAgentNames", () => {
  test("migrates legacy OmO names to Sisyphus", () => {
    // #given: Config with legacy OmO agent names
    const agents = {
      omo: { model: "anthropic/claude-opus-4-5" },
      OmO: { temperature: 0.5 },
      "OmO-Plan": { prompt: "custom prompt" },
    }

    // #when: Migrate agent names
    const { migrated, changed } = migrateAgentNames(agents)

    // #then: Legacy names should be migrated to Sisyphus
    expect(changed).toBe(true)
    expect(migrated["Sisyphus"]).toEqual({ temperature: 0.5 })
    expect(migrated["Planner-Sisyphus"]).toEqual({ prompt: "custom prompt" })
    expect(migrated["omo"]).toBeUndefined()
    expect(migrated["OmO"]).toBeUndefined()
    expect(migrated["OmO-Plan"]).toBeUndefined()
  })

  test("preserves current agent names unchanged", () => {
    // #given: Config with current agent names
    const agents = {
      oracle: { model: "openai/gpt-5.2" },
      librarian: { model: "google/gemini-3-flash" },
      explore: { model: "opencode/grok-code" },
    }

    // #when: Migrate agent names
    const { migrated, changed } = migrateAgentNames(agents)

    // #then: Current names should remain unchanged
    expect(changed).toBe(false)
    expect(migrated["oracle"]).toEqual({ model: "openai/gpt-5.2" })
    expect(migrated["librarian"]).toEqual({ model: "google/gemini-3-flash" })
    expect(migrated["explore"]).toEqual({ model: "opencode/grok-code" })
  })

  test("handles case-insensitive migration", () => {
    // #given: Config with mixed case agent names
    const agents = {
      SISYPHUS: { model: "test" },
      "PLANNER-SISYPHUS": { prompt: "test" },
    }

    // #when: Migrate agent names
    const { migrated, changed } = migrateAgentNames(agents)

    // #then: Case-insensitive lookup should migrate correctly
    expect(migrated["Sisyphus"]).toEqual({ model: "test" })
    expect(migrated["Planner-Sisyphus"]).toEqual({ prompt: "test" })
  })

  test("passes through unknown agent names unchanged", () => {
    // #given: Config with unknown agent name
    const agents = {
      "custom-agent": { model: "custom/model" },
    }

    // #when: Migrate agent names
    const { migrated, changed } = migrateAgentNames(agents)

    // #then: Unknown names should pass through
    expect(changed).toBe(false)
    expect(migrated["custom-agent"]).toEqual({ model: "custom/model" })
  })
})

describe("migrateHookNames", () => {
  test("migrates anthropic-auto-compact to anthropic-context-window-limit-recovery", () => {
    // #given: Config with legacy hook name
    const hooks = ["anthropic-auto-compact", "comment-checker"]

    // #when: Migrate hook names
    const { migrated, changed } = migrateHookNames(hooks)

    // #then: Legacy hook name should be migrated
    expect(changed).toBe(true)
    expect(migrated).toContain("anthropic-context-window-limit-recovery")
    expect(migrated).toContain("comment-checker")
    expect(migrated).not.toContain("anthropic-auto-compact")
  })

  test("preserves current hook names unchanged", () => {
    // #given: Config with current hook names
    const hooks = [
      "anthropic-context-window-limit-recovery",
      "todo-continuation-enforcer",
      "session-recovery",
    ]

    // #when: Migrate hook names
    const { migrated, changed } = migrateHookNames(hooks)

    // #then: Current names should remain unchanged
    expect(changed).toBe(false)
    expect(migrated).toEqual(hooks)
  })

  test("handles empty hooks array", () => {
    // #given: Empty hooks array
    const hooks: string[] = []

    // #when: Migrate hook names
    const { migrated, changed } = migrateHookNames(hooks)

    // #then: Should return empty array with no changes
    expect(changed).toBe(false)
    expect(migrated).toEqual([])
  })

  test("migrates multiple legacy hook names", () => {
    // #given: Multiple legacy hook names (if more are added in future)
    const hooks = ["anthropic-auto-compact"]

    // #when: Migrate hook names
    const { migrated, changed } = migrateHookNames(hooks)

    // #then: All legacy names should be migrated
    expect(changed).toBe(true)
    expect(migrated).toEqual(["anthropic-context-window-limit-recovery"])
  })
})

describe("migrateConfigFile", () => {
  const testConfigPath = "/tmp/nonexistent-path-for-test.json"

  test("migrates omo_agent to sisyphus_agent", () => {
    // #given: Config with legacy omo_agent key
    const rawConfig: Record<string, unknown> = {
      omo_agent: { disabled: false },
    }

    // #when: Migrate config file
    const needsWrite = migrateConfigFile(testConfigPath, rawConfig)

    // #then: omo_agent should be migrated to sisyphus_agent
    expect(needsWrite).toBe(true)
    expect(rawConfig.sisyphus_agent).toEqual({ disabled: false })
    expect(rawConfig.omo_agent).toBeUndefined()
  })

  test("migrates legacy agent names in agents object", () => {
    // #given: Config with legacy agent names
    const rawConfig: Record<string, unknown> = {
      agents: {
        omo: { model: "test" },
        OmO: { temperature: 0.5 },
      },
    }

    // #when: Migrate config file
    const needsWrite = migrateConfigFile(testConfigPath, rawConfig)

    // #then: Agent names should be migrated
    expect(needsWrite).toBe(true)
    const agents = rawConfig.agents as Record<string, unknown>
    expect(agents["Sisyphus"]).toBeDefined()
  })

  test("migrates legacy hook names in disabled_hooks", () => {
    // #given: Config with legacy hook names
    const rawConfig: Record<string, unknown> = {
      disabled_hooks: ["anthropic-auto-compact", "comment-checker"],
    }

    // #when: Migrate config file
    const needsWrite = migrateConfigFile(testConfigPath, rawConfig)

    // #then: Hook names should be migrated
    expect(needsWrite).toBe(true)
    expect(rawConfig.disabled_hooks).toContain("anthropic-context-window-limit-recovery")
    expect(rawConfig.disabled_hooks).not.toContain("anthropic-auto-compact")
  })

  test("does not write if no migration needed", () => {
    // #given: Config with current names
    const rawConfig: Record<string, unknown> = {
      sisyphus_agent: { disabled: false },
      agents: {
        Sisyphus: { model: "test" },
      },
      disabled_hooks: ["anthropic-context-window-limit-recovery"],
    }

    // #when: Migrate config file
    const needsWrite = migrateConfigFile(testConfigPath, rawConfig)

    // #then: No write should be needed
    expect(needsWrite).toBe(false)
  })

  test("handles migration of all legacy items together", () => {
    // #given: Config with all legacy items
    const rawConfig: Record<string, unknown> = {
      omo_agent: { disabled: false },
      agents: {
        omo: { model: "test" },
        "OmO-Plan": { prompt: "custom" },
      },
      disabled_hooks: ["anthropic-auto-compact"],
    }

    // #when: Migrate config file
    const needsWrite = migrateConfigFile(testConfigPath, rawConfig)

    // #then: All legacy items should be migrated
    expect(needsWrite).toBe(true)
    expect(rawConfig.sisyphus_agent).toEqual({ disabled: false })
    expect(rawConfig.omo_agent).toBeUndefined()
    const agents = rawConfig.agents as Record<string, unknown>
    expect(agents["Sisyphus"]).toBeDefined()
    expect(agents["Planner-Sisyphus"]).toBeDefined()
    expect(rawConfig.disabled_hooks).toContain("anthropic-context-window-limit-recovery")
  })
})

describe("migration maps", () => {
  test("AGENT_NAME_MAP contains all expected legacy mappings", () => {
    // #given/#when: Check AGENT_NAME_MAP
    // #then: Should contain all legacy → current mappings
    expect(AGENT_NAME_MAP["omo"]).toBe("Sisyphus")
    expect(AGENT_NAME_MAP["OmO"]).toBe("Sisyphus")
    expect(AGENT_NAME_MAP["OmO-Plan"]).toBe("Planner-Sisyphus")
    expect(AGENT_NAME_MAP["omo-plan"]).toBe("Planner-Sisyphus")
  })

  test("HOOK_NAME_MAP contains anthropic-auto-compact migration", () => {
    // #given/#when: Check HOOK_NAME_MAP
    // #then: Should contain the legacy hook name mapping
    expect(HOOK_NAME_MAP["anthropic-auto-compact"]).toBe("anthropic-context-window-limit-recovery")
  })
})
