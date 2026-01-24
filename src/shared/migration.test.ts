import { describe, test, expect, afterEach } from "bun:test"
import * as fs from "fs"
import * as path from "path"
import {
  AGENT_NAME_MAP,
  HOOK_NAME_MAP,
  migrateAgentNames,
  migrateHookNames,
  migrateConfigFile,
  migrateAgentConfigToCategory,
  shouldDeleteAgentConfig,
} from "./migration"

describe("migrateAgentNames", () => {
  test("migrates legacy OmO names to lowercase", () => {
    // #given: Config with legacy OmO agent names
    const agents = {
      omo: { model: "anthropic/claude-opus-4-5" },
      OmO: { temperature: 0.5 },
      "OmO-Plan": { prompt: "custom prompt" },
    }

    // #when: Migrate agent names
    const { migrated, changed } = migrateAgentNames(agents)

    // #then: Legacy names should be migrated to lowercase
    expect(changed).toBe(true)
    expect(migrated["sisyphus"]).toEqual({ temperature: 0.5 })
    expect(migrated["prometheus"]).toEqual({ prompt: "custom prompt" })
    expect(migrated["omo"]).toBeUndefined()
    expect(migrated["OmO"]).toBeUndefined()
    expect(migrated["OmO-Plan"]).toBeUndefined()
  })

  test("preserves current agent names unchanged", () => {
    // #given: Config with current agent names
    const agents = {
      oracle: { model: "openai/gpt-5.2" },
      librarian: { model: "google/gemini-3-flash" },
      explore: { model: "opencode/gpt-5-nano" },
    }

    // #when: Migrate agent names
    const { migrated, changed } = migrateAgentNames(agents)

    // #then: Current names should remain unchanged
    expect(changed).toBe(false)
    expect(migrated["oracle"]).toEqual({ model: "openai/gpt-5.2" })
    expect(migrated["librarian"]).toEqual({ model: "google/gemini-3-flash" })
    expect(migrated["explore"]).toEqual({ model: "opencode/gpt-5-nano" })
  })

  test("handles case-insensitive migration", () => {
    // #given: Config with mixed case agent names
    const agents = {
      SISYPHUS: { model: "test" },
      "planner-sisyphus": { prompt: "test" },
      "Orchestrator-Sisyphus": { model: "openai/gpt-5.2" },
    }

    // #when: Migrate agent names
    const { migrated, changed } = migrateAgentNames(agents)

    // #then: Case-insensitive lookup should migrate correctly
    expect(migrated["sisyphus"]).toEqual({ model: "test" })
    expect(migrated["prometheus"]).toEqual({ prompt: "test" })
    expect(migrated["atlas"]).toEqual({ model: "openai/gpt-5.2" })
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

  test("migrates orchestrator-sisyphus to atlas", () => {
    // #given: Config with legacy orchestrator-sisyphus agent name
    const agents = {
      "orchestrator-sisyphus": { model: "anthropic/claude-opus-4-5" },
    }

    // #when: Migrate agent names
    const { migrated, changed } = migrateAgentNames(agents)

    // #then: orchestrator-sisyphus should be migrated to atlas
    expect(changed).toBe(true)
    expect(migrated["atlas"]).toEqual({ model: "anthropic/claude-opus-4-5" })
    expect(migrated["orchestrator-sisyphus"]).toBeUndefined()
  })

  test("migrates lowercase atlas to atlas", () => {
    // #given: Config with lowercase atlas agent name
    const agents = {
      atlas: { model: "anthropic/claude-opus-4-5" },
    }

    // #when: Migrate agent names
    const { migrated, changed } = migrateAgentNames(agents)

    // #then: lowercase atlas should remain atlas (no change needed)
    expect(changed).toBe(false)
    expect(migrated["atlas"]).toEqual({ model: "anthropic/claude-opus-4-5" })
  })

  test("migrates Sisyphus variants to lowercase", () => {
    // #given agents config with "Sisyphus" key
    // #when migrateAgentNames called
    // #then key becomes "sisyphus"
    const agents = { "Sisyphus": { model: "test" } }
    const { migrated, changed } = migrateAgentNames(agents)
    expect(changed).toBe(true)
    expect(migrated["sisyphus"]).toEqual({ model: "test" })
    expect(migrated["Sisyphus"]).toBeUndefined()
  })

  test("migrates omo key to sisyphus", () => {
    // #given agents config with "omo" key
    // #when migrateAgentNames called
    // #then key becomes "sisyphus"
    const agents = { "omo": { model: "test" } }
    const { migrated, changed } = migrateAgentNames(agents)
    expect(changed).toBe(true)
    expect(migrated["sisyphus"]).toEqual({ model: "test" })
    expect(migrated["omo"]).toBeUndefined()
  })

  test("migrates Atlas variants to lowercase", () => {
    // #given agents config with "Atlas" key
    // #when migrateAgentNames called
    // #then key becomes "atlas"
    const agents = { "Atlas": { model: "test" } }
    const { migrated, changed } = migrateAgentNames(agents)
    expect(changed).toBe(true)
    expect(migrated["atlas"]).toEqual({ model: "test" })
    expect(migrated["Atlas"]).toBeUndefined()
  })

  test("migrates Prometheus variants to lowercase", () => {
    // #given agents config with "Prometheus (Planner)" key
    // #when migrateAgentNames called
    // #then key becomes "prometheus"
    const agents = { "Prometheus (Planner)": { model: "test" } }
    const { migrated, changed } = migrateAgentNames(agents)
    expect(changed).toBe(true)
    expect(migrated["prometheus"]).toEqual({ model: "test" })
    expect(migrated["Prometheus (Planner)"]).toBeUndefined()
  })

  test("migrates Metis variants to lowercase", () => {
    // #given agents config with "Metis (Plan Consultant)" key
    // #when migrateAgentNames called
    // #then key becomes "metis"
    const agents = { "Metis (Plan Consultant)": { model: "test" } }
    const { migrated, changed } = migrateAgentNames(agents)
    expect(changed).toBe(true)
    expect(migrated["metis"]).toEqual({ model: "test" })
    expect(migrated["Metis (Plan Consultant)"]).toBeUndefined()
  })

  test("migrates Momus variants to lowercase", () => {
    // #given agents config with "Momus (Plan Reviewer)" key
    // #when migrateAgentNames called
    // #then key becomes "momus"
    const agents = { "Momus (Plan Reviewer)": { model: "test" } }
    const { migrated, changed } = migrateAgentNames(agents)
    expect(changed).toBe(true)
    expect(migrated["momus"]).toEqual({ model: "test" })
    expect(migrated["Momus (Plan Reviewer)"]).toBeUndefined()
  })

  test("migrates Sisyphus-Junior to lowercase", () => {
    // #given agents config with "Sisyphus-Junior" key
    // #when migrateAgentNames called
    // #then key becomes "sisyphus-junior"
    const agents = { "Sisyphus-Junior": { model: "test" } }
    const { migrated, changed } = migrateAgentNames(agents)
    expect(changed).toBe(true)
    expect(migrated["sisyphus-junior"]).toEqual({ model: "test" })
    expect(migrated["Sisyphus-Junior"]).toBeUndefined()
  })

  test("preserves lowercase passthrough", () => {
    // #given agents config with "oracle" key
    // #when migrateAgentNames called
    // #then key remains "oracle" (no change needed)
    const agents = { "oracle": { model: "test" } }
    const { migrated, changed } = migrateAgentNames(agents)
    expect(changed).toBe(false)
    expect(migrated["oracle"]).toEqual({ model: "test" })
  })
})

describe("migrateHookNames", () => {
  test("migrates anthropic-auto-compact to anthropic-context-window-limit-recovery", () => {
    // #given: Config with legacy hook name
    const hooks = ["anthropic-auto-compact", "comment-checker"]

    // #when: Migrate hook names
    const { migrated, changed, removed } = migrateHookNames(hooks)

    // #then: Legacy hook name should be migrated
    expect(changed).toBe(true)
    expect(migrated).toContain("anthropic-context-window-limit-recovery")
    expect(migrated).toContain("comment-checker")
    expect(migrated).not.toContain("anthropic-auto-compact")
    expect(removed).toEqual([])
  })

  test("preserves current hook names unchanged", () => {
    // #given: Config with current hook names
    const hooks = [
      "anthropic-context-window-limit-recovery",
      "todo-continuation-enforcer",
      "session-recovery",
    ]

    // #when: Migrate hook names
    const { migrated, changed, removed } = migrateHookNames(hooks)

    // #then: Current names should remain unchanged
    expect(changed).toBe(false)
    expect(migrated).toEqual(hooks)
    expect(removed).toEqual([])
  })

  test("handles empty hooks array", () => {
    // #given: Empty hooks array
    const hooks: string[] = []

    // #when: Migrate hook names
    const { migrated, changed, removed } = migrateHookNames(hooks)

    // #then: Should return empty array with no changes
    expect(changed).toBe(false)
    expect(migrated).toEqual([])
    expect(removed).toEqual([])
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

  test("migrates sisyphus-orchestrator to atlas", () => {
    // #given: Config with legacy sisyphus-orchestrator hook
    const hooks = ["sisyphus-orchestrator", "comment-checker"]

    // #when: Migrate hook names
    const { migrated, changed, removed } = migrateHookNames(hooks)

    // #then: sisyphus-orchestrator should be migrated to atlas
    expect(changed).toBe(true)
    expect(migrated).toContain("atlas")
    expect(migrated).toContain("comment-checker")
    expect(migrated).not.toContain("sisyphus-orchestrator")
    expect(removed).toEqual([])
  })

  test("removes obsolete hooks and returns them in removed array", () => {
    // #given: Config with removed hooks from v3.0.0
    const hooks = ["preemptive-compaction", "empty-message-sanitizer", "comment-checker"]

    // #when: Migrate hook names
    const { migrated, changed, removed } = migrateHookNames(hooks)

    // #then: Removed hooks should be filtered out
    expect(changed).toBe(true)
    expect(migrated).toEqual(["comment-checker"])
    expect(removed).toContain("preemptive-compaction")
    expect(removed).toContain("empty-message-sanitizer")
    expect(removed).toHaveLength(2)
  })

  test("handles mixed migration and removal", () => {
    // #given: Config with both legacy rename and removed hooks
    const hooks = ["anthropic-auto-compact", "preemptive-compaction", "sisyphus-orchestrator"]

    // #when: Migrate hook names
    const { migrated, changed, removed } = migrateHookNames(hooks)

    // #then: Legacy should be renamed, removed should be filtered
    expect(changed).toBe(true)
    expect(migrated).toContain("anthropic-context-window-limit-recovery")
    expect(migrated).toContain("atlas")
    expect(migrated).not.toContain("preemptive-compaction")
    expect(removed).toEqual(["preemptive-compaction"])
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
    expect(agents["sisyphus"]).toBeDefined()
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
        sisyphus: { model: "test" },
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
    expect(agents["sisyphus"]).toBeDefined()
    expect(agents["prometheus"]).toBeDefined()
    expect(rawConfig.disabled_hooks).toContain("anthropic-context-window-limit-recovery")
  })
})

describe("migration maps", () => {
  test("AGENT_NAME_MAP contains all expected legacy mappings", () => {
    // #given/#when: Check AGENT_NAME_MAP
    // #then: Should contain all legacy → lowercase mappings
    expect(AGENT_NAME_MAP["omo"]).toBe("sisyphus")
    expect(AGENT_NAME_MAP["OmO"]).toBe("sisyphus")
    expect(AGENT_NAME_MAP["OmO-Plan"]).toBe("prometheus")
    expect(AGENT_NAME_MAP["omo-plan"]).toBe("prometheus")
    expect(AGENT_NAME_MAP["Planner-Sisyphus"]).toBe("prometheus")
    expect(AGENT_NAME_MAP["plan-consultant"]).toBe("metis")
  })

  test("HOOK_NAME_MAP contains anthropic-auto-compact migration", () => {
    // #given/#when: Check HOOK_NAME_MAP
    // #then: Should contain be legacy hook name mapping
    expect(HOOK_NAME_MAP["anthropic-auto-compact"]).toBe("anthropic-context-window-limit-recovery")
  })
})

describe("migrateAgentConfigToCategory", () => {
  test("migrates model to category when mapping exists", () => {
    // #given: Config with a model that has a category mapping
    const config = {
      model: "google/gemini-3-pro",
      temperature: 0.5,
      top_p: 0.9,
    }

    // #when: Migrate agent config to category
    const { migrated, changed } = migrateAgentConfigToCategory(config)

    // #then: Model should be replaced with category
    expect(changed).toBe(true)
    expect(migrated.category).toBe("visual-engineering")
    expect(migrated.model).toBeUndefined()
    expect(migrated.temperature).toBe(0.5)
    expect(migrated.top_p).toBe(0.9)
  })

  test("does not migrate when model is not in map", () => {
    // #given: Config with a model that has no mapping
    const config = {
      model: "custom/model",
      temperature: 0.5,
    }

    // #when: Migrate agent config to category
    const { migrated, changed } = migrateAgentConfigToCategory(config)

    // #then: Config should remain unchanged
    expect(changed).toBe(false)
    expect(migrated).toEqual(config)
  })

  test("does not migrate when model is not a string", () => {
    // #given: Config with non-string model
    const config = {
      model: { name: "test" },
      temperature: 0.5,
    }

    // #when: Migrate agent config to category
    const { migrated, changed } = migrateAgentConfigToCategory(config)

    // #then: Config should remain unchanged
    expect(changed).toBe(false)
    expect(migrated).toEqual(config)
  })

  test("handles all mapped models correctly", () => {
    // #given: Configs for each mapped model
    const configs = [
      { model: "google/gemini-3-pro" },
      { model: "google/gemini-3-flash" },
      { model: "openai/gpt-5.2" },
      { model: "anthropic/claude-haiku-4-5" },
      { model: "anthropic/claude-opus-4-5" },
      { model: "anthropic/claude-sonnet-4-5" },
    ]

    const expectedCategories = ["visual-engineering", "writing", "ultrabrain", "quick", "unspecified-high", "unspecified-low"]

    // #when: Migrate each config
    const results = configs.map(migrateAgentConfigToCategory)

    // #then: Each model should map to correct category
    results.forEach((result, index) => {
      expect(result.changed).toBe(true)
      expect(result.migrated.category).toBe(expectedCategories[index])
      expect(result.migrated.model).toBeUndefined()
    })
  })

  test("preserves non-model fields during migration", () => {
    // #given: Config with multiple fields
    const config = {
      model: "openai/gpt-5.2",
      temperature: 0.1,
      top_p: 0.95,
      maxTokens: 4096,
      prompt_append: "custom instruction",
    }

    // #when: Migrate agent config to category
    const { migrated } = migrateAgentConfigToCategory(config)

    // #then: All non-model fields should be preserved
    expect(migrated.category).toBe("ultrabrain")
    expect(migrated.temperature).toBe(0.1)
    expect(migrated.top_p).toBe(0.95)
    expect(migrated.maxTokens).toBe(4096)
    expect(migrated.prompt_append).toBe("custom instruction")
  })
})

describe("shouldDeleteAgentConfig", () => {
  test("returns true when config only has category field", () => {
    // #given: Config with only category field (no overrides)
    const config = { category: "visual-engineering" }

    // #when: Check if config should be deleted
    const shouldDelete = shouldDeleteAgentConfig(config, "visual-engineering")

    // #then: Should return true (matches category defaults)
    expect(shouldDelete).toBe(true)
  })

  test("returns false when category does not exist", () => {
    // #given: Config with unknown category
    const config = { category: "unknown" }

    // #when: Check if config should be deleted
    const shouldDelete = shouldDeleteAgentConfig(config, "unknown")

    // #then: Should return false (category not found)
    expect(shouldDelete).toBe(false)
  })

  test("returns true when all fields match category defaults", () => {
    // #given: Config with fields matching category defaults
    const config = {
      category: "visual-engineering",
      model: "google/gemini-3-pro",
    }

    // #when: Check if config should be deleted
    const shouldDelete = shouldDeleteAgentConfig(config, "visual-engineering")

    // #then: Should return true (all fields match defaults)
    expect(shouldDelete).toBe(true)
  })

  test("returns false when fields differ from category defaults", () => {
    // #given: Config with custom model override
    const config = {
      category: "visual-engineering",
      model: "anthropic/claude-opus-4-5",
    }

    // #when: Check if config should be deleted
    const shouldDelete = shouldDeleteAgentConfig(config, "visual-engineering")

    // #then: Should return false (has custom override)
    expect(shouldDelete).toBe(false)
  })

  test("handles different categories with their defaults", () => {
    // #given: Configs for different categories
    const configs = [
      { category: "ultrabrain" },
      { category: "quick" },
      { category: "unspecified-high" },
      { category: "unspecified-low" },
    ]

    // #when: Check each config
    const results = configs.map((config) => shouldDeleteAgentConfig(config, config.category as string))

    // #then: All should be true (all match defaults)
    results.forEach((result) => {
      expect(result).toBe(true)
    })
  })

  test("returns false when additional fields are present", () => {
    // #given: Config with extra fields
    const config = {
      category: "visual-engineering",
      temperature: 0.7,
      custom_field: "value", // Extra field not in defaults
    }

    // #when: Check if config should be deleted
    const shouldDelete = shouldDeleteAgentConfig(config, "visual-engineering")

    // #then: Should return false (has extra field)
    expect(shouldDelete).toBe(false)
  })

  test("handles complex config with multiple overrides", () => {
    // #given: Config with multiple custom overrides
    const config = {
      category: "visual-engineering",
      temperature: 0.5, // Different from default
      top_p: 0.8, // Different from default
      prompt_append: "custom prompt", // Custom field
    }

    // #when: Check if config should be deleted
    const shouldDelete = shouldDeleteAgentConfig(config, "visual-engineering")

    // #then: Should return false (has overrides)
    expect(shouldDelete).toBe(false)
  })
})

describe("migrateConfigFile with backup", () => {
  const cleanupPaths: string[] = []

  afterEach(() => {
    cleanupPaths.forEach((p) => {
      try {
        fs.unlinkSync(p)
      } catch {
      }
    })
  })

  test("creates backup file with timestamp when legacy migration needed", () => {
    // #given: Config file path with legacy agent names needing migration
    const testConfigPath = "/tmp/test-config-migration.json"
    const testConfigContent = globalThis.JSON.stringify({ agents: { omo: { model: "test" } } }, null, 2)
    const rawConfig: Record<string, unknown> = {
      agents: {
        omo: { model: "test" },
      },
    }

    fs.writeFileSync(testConfigPath, testConfigContent)
    cleanupPaths.push(testConfigPath)

    // #when: Migrate config file
    const needsWrite = migrateConfigFile(testConfigPath, rawConfig)

    // #then: Backup file should be created with timestamp
    expect(needsWrite).toBe(true)

    const dir = path.dirname(testConfigPath)
    const basename = path.basename(testConfigPath)
    const files = fs.readdirSync(dir)
    const backupFiles = files.filter((f) => f.startsWith(`${basename}.bak.`))
    expect(backupFiles.length).toBeGreaterThan(0)

    const backupFile = backupFiles[0]
    const backupPath = path.join(dir, backupFile)
    cleanupPaths.push(backupPath)

    expect(backupFile).toMatch(/test-config-migration\.json\.bak\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/)

    const backupContent = fs.readFileSync(backupPath, "utf-8")
    expect(backupContent).toBe(testConfigContent)
  })

  test("preserves model setting without auto-conversion to category", () => {
    // #given: Config with model setting (should NOT be converted to category)
    const testConfigPath = "/tmp/test-config-preserve-model.json"
    const rawConfig: Record<string, unknown> = {
      agents: {
        "multimodal-looker": { model: "anthropic/claude-haiku-4-5" },
        oracle: { model: "openai/gpt-5.2" },
        "my-custom-agent": { model: "google/gemini-3-pro" },
      },
    }

    fs.writeFileSync(testConfigPath, globalThis.JSON.stringify(rawConfig, null, 2))
    cleanupPaths.push(testConfigPath)

    // #when: Migrate config file
    const needsWrite = migrateConfigFile(testConfigPath, rawConfig)

    // #then: No migration needed - model settings should be preserved as-is
    expect(needsWrite).toBe(false)

    const agents = rawConfig.agents as Record<string, Record<string, unknown>>
    expect(agents["multimodal-looker"].model).toBe("anthropic/claude-haiku-4-5")
    expect(agents.oracle.model).toBe("openai/gpt-5.2")
    expect(agents["my-custom-agent"].model).toBe("google/gemini-3-pro")
  })

  test("preserves category setting when explicitly set", () => {
    // #given: Config with explicit category setting
    const testConfigPath = "/tmp/test-config-preserve-category.json"
    const rawConfig: Record<string, unknown> = {
      agents: {
        "multimodal-looker": { category: "quick" },
        oracle: { category: "ultrabrain" },
      },
    }

    fs.writeFileSync(testConfigPath, globalThis.JSON.stringify(rawConfig, null, 2))
    cleanupPaths.push(testConfigPath)

    // #when: Migrate config file
    const needsWrite = migrateConfigFile(testConfigPath, rawConfig)

    // #then: No migration needed - category settings should be preserved as-is
    expect(needsWrite).toBe(false)

    const agents = rawConfig.agents as Record<string, Record<string, unknown>>
    expect(agents["multimodal-looker"].category).toBe("quick")
    expect(agents.oracle.category).toBe("ultrabrain")
  })

  test("does not write when no migration needed", () => {
     // #given: Config with no migrations needed
     const testConfigPath = "/tmp/test-config-no-migration.json"
     const rawConfig: Record<string, unknown> = {
       agents: {
         sisyphus: { model: "test" },
       },
     }

     fs.writeFileSync(testConfigPath, globalThis.JSON.stringify({ agents: { sisyphus: { model: "test" } } }, null, 2))
     cleanupPaths.push(testConfigPath)

     // Clean up any existing backup files from previous test runs
     const dir = path.dirname(testConfigPath)
     const basename = path.basename(testConfigPath)
     const existingFiles = fs.readdirSync(dir)
     const existingBackups = existingFiles.filter((f) => f.startsWith(`${basename}.bak.`))
     existingBackups.forEach((f) => {
       const backupPath = path.join(dir, f)
       try {
         fs.unlinkSync(backupPath)
         cleanupPaths.splice(cleanupPaths.indexOf(backupPath), 1)
       } catch {
       }
     })

     // #when: Migrate config file
     const needsWrite = migrateConfigFile(testConfigPath, rawConfig)

     // #then: Should not write or create backup
     expect(needsWrite).toBe(false)

     const files = fs.readdirSync(dir)
     const backupFiles = files.filter((f) => f.startsWith(`${basename}.bak.`))
     expect(backupFiles.length).toBe(0)
   })


})
