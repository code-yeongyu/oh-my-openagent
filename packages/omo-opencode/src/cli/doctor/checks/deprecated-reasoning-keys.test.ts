import { describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

describe("deprecated reasoning keys check", () => {
  it("reports deprecated reasoning keys with exact file and key path", async () => {
    //#given a unified config containing deprecated reasoning keys
    const originalConfigDir = process.env.OPENCODE_CONFIG_DIR
    const originalHome = process.env.HOME
    const originalCwd = process.cwd()
    const testRootDir = join(
      tmpdir(),
      `omo-doctor-deprecated-reasoning-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    const projectDir = join(testRootDir, "project")
    const configPath = join(testRootDir, ".omo", "omo.jsonc")

    try {
      mkdirSync(projectDir, { recursive: true })
      mkdirSync(join(testRootDir, ".omo"), { recursive: true })
      process.env.HOME = testRootDir
      delete process.env.OPENCODE_CONFIG_DIR
      writeFileSync(
        configPath,
        JSON.stringify(
          {
            categories: {
              deep: {
                model: "openai/gpt-5.6-sol",
                variant: "high",
              },
            },
            agents: {
              oracle: {
                model: "openai/gpt-5.6-sol",
                reasoningEffort: "max",
              },
            },
            profiles: {
              focused: {
                "[opencode]": {
                  agents: {
                    sisyphus: {
                      thinking: { type: "disabled" },
                      textVerbosity: "high",
                    },
                  },
                },
              },
            },
          },
          null,
          2,
        ) + "\n",
        "utf-8",
      )
      process.chdir(projectDir)

      //#when running the deprecated reasoning keys check
      const { checkDeprecatedReasoningKeys } = await import("./deprecated-reasoning-keys")
      const result = await checkDeprecatedReasoningKeys()

      //#then the exact file and key paths are reported
      expect(result.status).toBe("warn")
      expect(result.issues.map((issue) => issue.description)).toEqual([
        `${configPath}: categories.deep.variant`,
        `${configPath}: agents.oracle.reasoningEffort`,
      ])
    } finally {
      process.chdir(originalCwd)
      rmSync(testRootDir, { recursive: true, force: true })
      if (originalConfigDir === undefined) {
        delete process.env.OPENCODE_CONFIG_DIR
      } else {
        process.env.OPENCODE_CONFIG_DIR = originalConfigDir
      }
      if (originalHome === undefined) {
        delete process.env.HOME
      } else {
        process.env.HOME = originalHome
      }
    }
  })

  it("ignores plugin-supported reasoning keys inside opencode harness blocks", async () => {
    //#given canonical base config plus plugin-specific opencode tuning
    const originalConfigDir = process.env.OPENCODE_CONFIG_DIR
    const originalHome = process.env.HOME
    const originalCwd = process.cwd()
    const testRootDir = mkdtempSync(join(tmpdir(), "omo-doctor-opencode-reasoning-"))
    const projectDir = join(testRootDir, "project")
    const configPath = join(testRootDir, ".omo", "omo.jsonc")

    try {
      mkdirSync(projectDir, { recursive: true })
      mkdirSync(join(testRootDir, ".omo"), { recursive: true })
      process.env.HOME = testRootDir
      delete process.env.OPENCODE_CONFIG_DIR
      writeFileSync(
        configPath,
        JSON.stringify(
          {
            categories: {
              deep: {
                model: "openai/gpt-5.6-sol",
                variant: "high",
              },
            },
            "[opencode]": {
              agents: {
                explore: {
                  model: "openai/gpt-5.6-luna",
                  variant: "low",
                  fallback_models: ["openai/gpt-5.6-terra"],
                },
              },
            },
            "[senpi]": {
              agents: {
                explore: {
                  variant: "medium",
                },
              },
            },
            "[codex]": {
              categories: {
                deep: {
                  fallback_models: ["openai/gpt-5.6-terra"],
                },
              },
            },
          },
          null,
          2,
        ) + "\n",
        "utf-8",
      )
      process.chdir(projectDir)

      //#when running the deprecated reasoning keys check
      const { checkDeprecatedReasoningKeys } = await import("./deprecated-reasoning-keys")
      const result = await checkDeprecatedReasoningKeys()

      //#then only canonical base keys are reported
      expect(result.status).toBe("warn")
      expect(result.issues.map((issue) => issue.description)).toEqual([
        `${configPath}: categories.deep.variant`,
        `${configPath}: [senpi].agents.explore.variant`,
        `${configPath}: [codex].categories.deep.fallback_models`,
      ])
    } finally {
      process.chdir(originalCwd)
      rmSync(testRootDir, { recursive: true, force: true })
      if (originalConfigDir === undefined) {
        delete process.env.OPENCODE_CONFIG_DIR
      } else {
        process.env.OPENCODE_CONFIG_DIR = originalConfigDir
      }
      if (originalHome === undefined) {
        delete process.env.HOME
      } else {
        process.env.HOME = originalHome
      }
    }
  })

  it("ignores canonical provider_options passthrough keys while keeping accurate labels", async () => {
    //#given migrated canonical config using provider_options passthrough plus two genuinely deprecated keys
    const originalConfigDir = process.env.OPENCODE_CONFIG_DIR
    const originalHome = process.env.HOME
    const originalCwd = process.cwd()
    const testRootDir = mkdtempSync(join(tmpdir(), "omo-doctor-provider-options-"))
    const projectDir = join(testRootDir, "project")
    const configPath = join(testRootDir, ".omo", "omo.jsonc")

    try {
      mkdirSync(projectDir, { recursive: true })
      mkdirSync(join(testRootDir, ".omo"), { recursive: true })
      process.env.HOME = testRootDir
      delete process.env.OPENCODE_CONFIG_DIR
      writeFileSync(
        configPath,
        JSON.stringify(
          {
            categories: {
              deep: {
                model: "openai/gpt-5.6-sol",
                variant: "high",
                thinking: { type: "disabled" },
                provider_options: {
                  thinking: { type: "enabled", budgetTokens: 64000 },
                  textVerbosity: "high",
                },
              },
            },
            agents: {
              oracle: {
                models: ["openai/gpt-5.6-sol"],
                provider_options: { thinking: { type: "enabled" } },
              },
            },
            models: {
              sol: {
                model: "openai/gpt-5.6-sol",
                provider_options: { textVerbosity: "low" },
              },
            },
            "[codex]": {
              agents: {
                explore: {
                  providerOptions: { textVerbosity: "medium" },
                },
              },
            },
          },
          null,
          2,
        ) + "\n",
        "utf-8",
      )
      process.chdir(projectDir)

      //#when running the deprecated reasoning keys check
      const { checkDeprecatedReasoningKeys } = await import("./deprecated-reasoning-keys")
      const result = await checkDeprecatedReasoningKeys()

      //#then only the genuinely deprecated keys are reported, with accurate titles and fixes
      expect(result.status).toBe("warn")
      expect(result.issues.map((issue) => issue.description)).toEqual([
        `${configPath}: categories.deep.variant`,
        `${configPath}: categories.deep.thinking`,
      ])
      expect(result.issues.map((issue) => issue.title)).toEqual([
        "Deprecated config key",
        "Deprecated config key",
      ])
      expect(result.issues.map((issue) => issue.fix)).toEqual([
        "Replace variant with reasoning, or run: oh-my-openagent config migrate",
        'Replace thinking with reasoning: "off" or provider_options.thinking, or run: oh-my-openagent config migrate',
      ])
      expect(result.message).toBe("2 deprecated config key(s) found")
    } finally {
      process.chdir(originalCwd)
      rmSync(testRootDir, { recursive: true, force: true })
      if (originalConfigDir === undefined) {
        delete process.env.OPENCODE_CONFIG_DIR
      } else {
        process.env.OPENCODE_CONFIG_DIR = originalConfigDir
      }
      if (originalHome === undefined) {
        delete process.env.HOME
      } else {
        process.env.HOME = originalHome
      }
    }
  })
})
