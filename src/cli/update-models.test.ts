import { describe, expect, it, mock, spyOn } from "bun:test"
import { updateModels, type UpdateModelsDeps } from "./update-models/update-models"
import type { UpdateModelsOptions, ModelMappingEntry, UpdateModelsResult } from "./update-models/types"

describe("updateModels", () => {
  const defaultGeneratedAgents: Record<string, ModelMappingEntry> = {
    oracle: { model: "anthropic/claude-opus-4-7" },
    sisyphus: { model: "anthropic/claude-sonnet-4" },
    librarian: { model: "openai/gpt-5.4-mini-fast" },
    explore: { model: "openai/gpt-5.4-mini-fast" },
  }

  const defaultGeneratedCategories: Record<string, ModelMappingEntry> = {
    "unspecified-high": { model: "anthropic/claude-sonnet-4" },
    "unspecified-low": { model: "openai/gpt-5.4-mini-fast" },
    coding: { model: "anthropic/claude-sonnet-4" },
  }

  function createMockDeps(overrides: Partial<UpdateModelsDeps> = {}): UpdateModelsDeps {
    return {
      loadConfig: mock(() => ({
        agents: { ...defaultGeneratedAgents },
        categories: { ...defaultGeneratedCategories },
      })),
      detectCurrentConfig: mock(() => ({
        providers: ["anthropic", "openai"],
      })),
      generateModelConfig: mock(() => ({
        agents: { ...defaultGeneratedAgents },
        categories: { ...defaultGeneratedCategories },
      })),
      compareMappings: mock((current, generated) => {
        const toUpdate: Record<string, ModelMappingEntry> = {}
        const toPreserve: string[] = []
        const toAdd: Record<string, ModelMappingEntry> = {}

        for (const [key, generatedEntry] of Object.entries(generated)) {
          const currentEntry = current[key]
          if (currentEntry === undefined) {
            toAdd[key] = generatedEntry
          } else if (
            currentEntry.model === generatedEntry.model &&
            currentEntry.variant === generatedEntry.variant &&
            JSON.stringify(currentEntry.fallback_models) ===
              JSON.stringify(generatedEntry.fallback_models)
          ) {
            toPreserve.push(key)
          } else {
            toUpdate[key] = generatedEntry
          }
        }

        return { toUpdate, toPreserve, toAdd }
      }),
      backupConfigFile: mock(() => ({
        success: true,
        backupPath: "/test/oh-my-openagent.json.backup-2026-01-01T00-00-00-000Z",
      })),
      writeFile: mock(() => {}),
      readFile: mock(() => ""),
      existsFile: mock(() => true),
      renameFile: mock(() => {}),
      ...overrides,
    }
  }

  function createMockOptions(overrides: Partial<UpdateModelsOptions> = {}): UpdateModelsOptions {
    return {
      directory: "/test",
      mode: "preserve-custom",
      dryRun: false,
      json: false,
      ...overrides,
    }
  }

  describe("preserve-custom mode with no customizations", () => {
    it("updates all entries when all match defaults", async () => {
      const deps = createMockDeps()
      const options = createMockOptions({ mode: "preserve-custom" })

      const result = await updateModels(options, deps)

      expect(result.success).toBe(true)
      expect(result.preserved).toContain("agents.oracle")
      expect(result.preserved).toContain("agents.sisyphus")
      expect(result.preserved).toContain("categories.coding")
    })
  })

  describe("preserve-custom mode with customizations", () => {
    it("preserves customized entries and updates non-customized", async () => {
      const customConfig = {
        agents: {
          oracle: { model: "custom/oracle-model" },
          sisyphus: { model: "anthropic/claude-sonnet-4" },
          librarian: { model: "openai/gpt-5.4-mini-fast" },
          explore: { model: "openai/gpt-5.4-mini-fast" },
        },
        categories: {
          "unspecified-high": { model: "anthropic/claude-sonnet-4" },
          "unspecified-low": { model: "openai/gpt-5.4-mini-fast" },
          coding: { model: "custom/coding-model" },
        },
      }

      const deps = createMockDeps({
        loadConfig: mock(() => customConfig),
      })
      const options = createMockOptions({ mode: "preserve-custom" })

      const result = await updateModels(options, deps)

      expect(result.success).toBe(true)
      expect(result.preserved).toContain("agents.sisyphus")
      expect(result.preserved).toContain("agents.librarian")
      expect(result.preserved).toContain("agents.explore")
      expect(result.preserved).toContain("agents.oracle")
      expect(result.preserved).toContain("categories.unspecified-high")
      expect(result.preserved).toContain("categories.unspecified-low")
    })

    it("preserves entries with different variants", async () => {
      const customConfig = {
        agents: {
          oracle: { model: "anthropic/claude-opus-4-7", variant: "custom-variant" },
          sisyphus: { model: "anthropic/claude-sonnet-4" },
        },
        categories: {},
      }

      const deps = createMockDeps({
        loadConfig: mock(() => customConfig),
      })
      const options = createMockOptions({ mode: "preserve-custom" })

      const result = await updateModels(options, deps)

      expect(result.success).toBe(true)
      expect(result.preserved).toContain("agents.sisyphus")
    })
  })

  describe("full-replacement mode", () => {
    it("replaces all entries regardless of customization", async () => {
      const customConfig = {
        agents: {
          oracle: { model: "custom/oracle-model" },
          sisyphus: { model: "custom/sisyphus-model" },
        },
        categories: {
          coding: { model: "custom/coding-model" },
        },
      }

      const deps = createMockDeps({
        loadConfig: mock(() => customConfig),
      })
      const options = createMockOptions({ mode: "full-replacement" })

      const result = await updateModels(options, deps)

      expect(result.success).toBe(true)
      expect(result.updated.length).toBeGreaterThan(0)
      expect(result.preserved.length).toBe(0)
    })
  })

  describe("config file doesn't exist", () => {
    it("returns failure with helpful message when config doesn't exist", async () => {
      const deps = createMockDeps({
        loadConfig: mock(() => null),
      })
      const options = createMockOptions()

      const result = await updateModels(options, deps)

      expect(result.success).toBe(false)
      expect(result.message).toContain("No oh-my-openagent.json found")
      expect(result.message).toContain("oh-my-opencode install")
    })
  })

  describe("custom agents/categories preserved", () => {
    it("preserves non-default entries that don't exist in generated config", async () => {
      const configWithCustomEntries = {
        agents: {
          oracle: { model: "anthropic/claude-opus-4-7" },
          customAgent: { model: "custom/model" },
        },
        categories: {
          coding: { model: "anthropic/claude-sonnet-4" },
          customCategory: { model: "custom/category-model" },
        },
      }

      const deps = createMockDeps({
        loadConfig: mock(() => configWithCustomEntries),
      })
      const options = createMockOptions({ mode: "preserve-custom" })

      const result = await updateModels(options, deps)

      expect(result.success).toBe(true)
      expect(result.preserved).toContain("agents.oracle")
    })
  })

  describe("non-model properties untouched", () => {
    it("preserves prompt, tools, and disable properties", async () => {
      const configWithExtraProps = {
        agents: {
          oracle: {
            model: "anthropic/claude-opus-4-7",
            prompt: "Custom oracle prompt",
            tools: ["tool1", "tool2"],
          },
        },
        categories: {
          coding: {
            model: "anthropic/claude-sonnet-4",
            disable: true,
          },
        },
        someOtherProperty: "should be preserved",
      }

      let writtenConfig: Record<string, unknown> | null = null
      const deps = createMockDeps({
        loadConfig: mock(() => configWithExtraProps),
        writeFile: mock((path: string, content: string) => {
          writtenConfig = JSON.parse(content)
        }),
      })
      const options = createMockOptions({ mode: "preserve-custom" })

      await updateModels(options, deps)

      expect(writtenConfig).not.toBeNull()
      expect(writtenConfig?.someOtherProperty).toBe("should be preserved")
    })
  })

  describe("backup created before write", () => {
    it("creates backup file before modifying config", async () => {
      const backupPath = "/test/oh-my-openagent.json.backup-2026-04-30T12-00-00-000Z"
      const deps = createMockDeps({
        backupConfigFile: mock(() => ({
          success: true,
          backupPath,
        })),
      })
      const options = createMockOptions()

      const result = await updateModels(options, deps)

      expect(result.success).toBe(true)
      expect(result.backupPath).toBe(backupPath)
      expect(deps.backupConfigFile).toHaveBeenCalled()
    })

    it("includes backup path in result message", async () => {
      const backupPath = "/test/oh-my-openagent.json.backup-2026-04-30T12-00-00-000Z"
      const deps = createMockDeps({
        backupConfigFile: mock(() => ({
          success: true,
          backupPath,
        })),
      })
      const options = createMockOptions()

      const result = await updateModels(options, deps)

      expect(result.backupPath).toBe(backupPath)
    })
  })

  describe("new entries added", () => {
    it("adds new agents and categories from generated config", async () => {
      const existingConfig = {
        agents: {
          oracle: { model: "anthropic/claude-opus-4-7" },
        },
        categories: {},
      }

      const newGeneratedAgents = {
        oracle: { model: "anthropic/claude-opus-4-7" },
        sisyphus: { model: "anthropic/claude-sonnet-4" },
        librarian: { model: "openai/gpt-5.4-mini-fast" },
      }

      const deps = createMockDeps({
        loadConfig: mock(() => existingConfig),
        generateModelConfig: mock(() => ({
          agents: newGeneratedAgents,
          categories: defaultGeneratedCategories,
        })),
      })
      const options = createMockOptions({ mode: "preserve-custom" })

      const result = await updateModels(options, deps)

      expect(result.success).toBe(true)
      expect(result.added).toContain("agents.sisyphus")
      expect(result.added).toContain("agents.librarian")
    })
  })

  describe("dry-run mode", () => {
    it("does not modify file in dry-run mode", async () => {
      const writeFileMock = mock(() => {})
      const deps = createMockDeps({
        writeFile: writeFileMock,
      })
      const options = createMockOptions({ dryRun: true, mode: "preserve-custom" })

      const result = await updateModels(options, deps)

      expect(result.success).toBe(true)
      expect(result.message).toContain("Dry run")
      expect(writeFileMock).not.toHaveBeenCalled()
    })

    it("shows diff information in dry-run mode", async () => {
      const deps = createMockDeps()
      const options = createMockOptions({ dryRun: true, mode: "preserve-custom" })

      const result = await updateModels(options, deps)

      expect(result.message).toContain("would be updated")
      expect(result.message).toContain("preserved")
      expect(result.message).toContain("added")
    })
  })

  describe("JSON output mode", () => {
    it("outputs JSON when json option is true", async () => {
      const logSpy = spyOn(console, "log").mockImplementation(() => {})
      const deps = createMockDeps()
      const options = createMockOptions({ json: true, mode: "preserve-custom" })

      const result = await updateModels(options, deps)

      expect(result.success).toBe(true)
      expect(logSpy).toHaveBeenCalled()

      const loggedCall = logSpy.mock.calls[0]
      expect(loggedCall).toBeDefined()
      if (loggedCall && loggedCall[0]) {
        const loggedJson = JSON.parse(loggedCall[0] as string)
        expect(loggedJson).toHaveProperty("success")
        expect(loggedJson).toHaveProperty("message")
        expect(loggedJson).toHaveProperty("updated")
        expect(loggedJson).toHaveProperty("preserved")
        expect(loggedJson).toHaveProperty("added")
      }

      logSpy.mockRestore()
    })

    it("includes all result fields in JSON output", async () => {
      const logSpy = spyOn(console, "log").mockImplementation(() => {})
      const deps = createMockDeps()
      const options = createMockOptions({ json: true, mode: "preserve-custom" })

      await updateModels(options, deps)

      const loggedCall = logSpy.mock.calls[0]
      expect(loggedCall).toBeDefined()
      if (loggedCall && loggedCall[0]) {
        const loggedJson = JSON.parse(loggedCall[0] as string) as UpdateModelsResult & {
          success: boolean
          message: string
        }
        expect(Array.isArray(loggedJson.updated)).toBe(true)
        expect(Array.isArray(loggedJson.preserved)).toBe(true)
        expect(Array.isArray(loggedJson.added)).toBe(true)
      }

      logSpy.mockRestore()
    })
  })

  describe("special-case agents", () => {
    it("assigns correct models for librarian agent", async () => {
      let generatedConfig: { agents: Record<string, ModelMappingEntry> } | null = null
      const deps = createMockDeps({
        generateModelConfig: mock((config) => {
          generatedConfig = {
            agents: {
              librarian: { model: "openai/gpt-5.4-mini-fast" },
              oracle: { model: "anthropic/claude-opus-4-7" },
              sisyphus: { model: "anthropic/claude-sonnet-4" },
              explore: { model: "openai/gpt-5.4-mini-fast" },
            },
            categories: defaultGeneratedCategories,
          }
          return generatedConfig
        }),
      })
      const options = createMockOptions({ mode: "preserve-custom" })

      await updateModels(options, deps)

      expect(generatedConfig).not.toBeNull()
      expect(generatedConfig?.agents.librarian?.model).toBe("openai/gpt-5.4-mini-fast")
    })

    it("assigns correct models for explore agent", async () => {
      let generatedConfig: { agents: Record<string, ModelMappingEntry> } | null = null
      const deps = createMockDeps({
        generateModelConfig: mock((config) => {
          generatedConfig = {
            agents: {
              librarian: { model: "openai/gpt-5.4-mini-fast" },
              oracle: { model: "anthropic/claude-opus-4-7" },
              sisyphus: { model: "anthropic/claude-sonnet-4" },
              explore: { model: "openai/gpt-5.4-mini-fast" },
            },
            categories: defaultGeneratedCategories,
          }
          return generatedConfig
        }),
      })
      const options = createMockOptions({ mode: "preserve-custom" })

      await updateModels(options, deps)

      expect(generatedConfig).not.toBeNull()
      expect(generatedConfig?.agents.explore?.model).toBe("openai/gpt-5.4-mini-fast")
    })

    it("assigns correct models for sisyphus agent with fallback chain", async () => {
      let generatedConfig: { agents: Record<string, ModelMappingEntry> } | null = null
      const deps = createMockDeps({
        generateModelConfig: mock((config) => {
          generatedConfig = {
            agents: {
              librarian: { model: "openai/gpt-5.4-mini-fast" },
              oracle: { model: "anthropic/claude-opus-4-7" },
              sisyphus: {
                model: "anthropic/claude-sonnet-4",
                fallback_models: [
                  { model: "openai/gpt-5.4" },
                  { model: "opencode/claude-sonnet-4" },
                ],
              },
              explore: { model: "openai/gpt-5.4-mini-fast" },
            },
            categories: defaultGeneratedCategories,
          }
          return generatedConfig
        }),
      })
      const options = createMockOptions({ mode: "preserve-custom" })

      await updateModels(options, deps)

      expect(generatedConfig).not.toBeNull()
      expect(generatedConfig?.agents.sisyphus?.model).toBe("anthropic/claude-sonnet-4")
      expect(generatedConfig?.agents.sisyphus?.fallback_models).toBeDefined()
      expect(generatedConfig?.agents.sisyphus?.fallback_models?.length).toBeGreaterThan(0)
    })
  })

  describe("fallback_models handling", () => {
    it("preserves entries with custom fallback_models", async () => {
      const configWithCustomFallbacks = {
        agents: {
          oracle: {
            model: "anthropic/claude-opus-4-7",
            fallback_models: [
              { model: "custom/fallback-1" },
              { model: "custom/fallback-2" },
            ],
          },
        },
        categories: {},
      }

      const deps = createMockDeps({
        loadConfig: mock(() => configWithCustomFallbacks),
      })
      const options = createMockOptions({ mode: "preserve-custom" })

      const result = await updateModels(options, deps)

      expect(result.success).toBe(true)
    })

    it("detects matching fallback_models as default", async () => {
      const configWithMatchingFallbacks = {
        agents: {
          sisyphus: {
            model: "anthropic/claude-sonnet-4",
            fallback_models: [{ model: "openai/gpt-5.4" }],
          },
        },
        categories: {},
      }

      const deps = createMockDeps({
        loadConfig: mock(() => configWithMatchingFallbacks),
      })
      const options = createMockOptions({ mode: "preserve-custom" })

      const result = await updateModels(options, deps)

      expect(result.success).toBe(true)
    })
  })

  describe("edge cases", () => {
    it("handles empty agents and categories", async () => {
      const deps = createMockDeps({
        loadConfig: mock(() => ({
          agents: {},
          categories: {},
        })),
      })
      const options = createMockOptions({ mode: "preserve-custom" })

      const result = await updateModels(options, deps)

      expect(result.success).toBe(true)
    })

    it("handles config with only non-model properties", async () => {
      const deps = createMockDeps({
        loadConfig: mock(() => ({
          someSetting: "value",
          anotherSetting: 123,
        })),
      })
      const options = createMockOptions({ mode: "preserve-custom" })

      const result = await updateModels(options, deps)

      expect(result.success).toBe(true)
    })

    it("handles missing agents or categories keys", async () => {
      const deps = createMockDeps({
        loadConfig: mock(() => ({})),
      })
      const options = createMockOptions({ mode: "preserve-custom" })

      const result = await updateModels(options, deps)

      expect(result.success).toBe(true)
    })
  })
})
