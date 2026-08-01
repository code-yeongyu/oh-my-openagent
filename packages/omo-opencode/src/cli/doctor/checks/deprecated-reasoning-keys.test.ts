import { describe, expect, it } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
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
        `${configPath}: [opencode].agents.sisyphus.thinking`,
        `${configPath}: [opencode].agents.sisyphus.textVerbosity`,
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
})
