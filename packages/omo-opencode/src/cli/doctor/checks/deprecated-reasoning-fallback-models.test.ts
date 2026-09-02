import { describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

describe("deprecated fallback_models key check", () => {
  it("does not report base agent fallback_models while preserving category migration guidance", async () => {
    //#given base agent and category fallback model overrides
    const originalConfigDir = process.env.OPENCODE_CONFIG_DIR
    const originalHome = process.env.HOME
    const originalCwd = process.cwd()
    const testRootDir = mkdtempSync(join(tmpdir(), "omo-doctor-fallback-models-"))
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
            agents: {
              oracle: {
                model: "openai/gpt-5.6-sol",
                fallback_models: ["openai/gpt-5.6-terra"],
              },
            },
            categories: {
              deep: {
                model: "openai/gpt-5.6-sol",
                fallback_models: ["openai/gpt-5.6-terra"],
              },
            },
          },
          null,
          2,
        ) + "\n",
        "utf-8",
      )
      process.chdir(projectDir)

      //#when running the deprecated config key check
      const { checkDeprecatedReasoningKeys } = await import("./deprecated-reasoning-keys")
      const result = await checkDeprecatedReasoningKeys()

      //#then only the category fallback_models key is reported
      expect(result.status).toBe("warn")
      expect(result.issues.map((issue) => issue.description)).toEqual([
        `${configPath}: categories.deep.fallback_models`,
      ])
      expect(result.issues[0]?.fix).toBe("Run: oh-my-openagent config migrate to convert fallback_models into a models chain")
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

  it("reports opencode category fallback_models while ignoring opencode agent fallback_models", async () => {
    //#given opencode agent, opencode category, and typed harness agent fallback model overrides
    const originalConfigDir = process.env.OPENCODE_CONFIG_DIR
    const originalHome = process.env.HOME
    const originalCwd = process.cwd()
    const testRootDir = mkdtempSync(join(tmpdir(), "omo-doctor-typed-fallback-models-"))
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
            "[opencode]": {
              agents: {
                oracle: {
                  fallback_models: ["openai/gpt-5.6-terra"],
                },
              },
              categories: {
                deep: {
                  fallback_models: ["openai/gpt-5.6-terra"],
                },
              },
            },
            "[senpi]": {
              agents: {
                oracle: {
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

      //#when running the deprecated config key check
      const { checkDeprecatedReasoningKeys } = await import("./deprecated-reasoning-keys")
      const result = await checkDeprecatedReasoningKeys()

      //#then opencode category and typed harness agent fallback_models keys are reported
      expect(result.status).toBe("warn")
      const descriptions = result.issues.map((issue) => issue.description)
      expect(descriptions).toEqual([
        `${configPath}: [opencode].categories.deep.fallback_models`,
        `${configPath}: [senpi].agents.oracle.fallback_models`,
      ])
      expect(descriptions).not.toContain(`${configPath}: [opencode].agents.oracle.fallback_models`)
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

  it("exports fallback_models replacement metadata while schemas still accept legacy keys", async () => {
    //#given the doctor replacement table and the matching config schemas
    const [doctorKeys, schemas] = await Promise.all([
      import("./deprecated-reasoning-keys"),
      import("../../../config/schema"),
    ])

    //#when comparing fallback_models replacement scope against agent and category schemas
    const schemaByContainer = {
      agents: schemas.AgentOverrideConfigSchema,
      categories: schemas.CategoryConfigSchema,
    }

    //#then OpenCode agents keep schema-supported fallback_models, while categories keep migration guidance
    expect(doctorKeys.DEPRECATED_CONFIG_KEY_REPLACEMENTS).toBeDefined()
    const fallbackRule = doctorKeys.DEPRECATED_CONFIG_KEY_REPLACEMENTS.find((rule) => rule.key === "fallback_models")
    expect(fallbackRule).toBeDefined()
    expect(Object.hasOwn(schemaByContainer.agents.shape, "fallback_models")).toBe(true)
    expect(Object.hasOwn(schemaByContainer.categories.shape, "fallback_models")).toBe(true)
  })
})
