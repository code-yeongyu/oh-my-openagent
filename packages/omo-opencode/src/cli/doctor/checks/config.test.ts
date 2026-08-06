import { describe, it, expect } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as config from "./config"

function normalizePathForAssertion(filePath: string): string {
  return filePath.replaceAll("\\", "/").replaceAll("/private/var/", "/var/")
}

describe("config check", () => {
  describe("checkConfig", () => {
    it("returns a valid CheckResult", async () => {
      //#given config check is available
      //#when running the consolidated config check
      const result = await config.checkConfig()

      //#then should return a properly shaped CheckResult
      expect(result.name).toBe("Configuration")
      expect(["pass", "fail", "warn", "skip"]).toContain(result.status)
      expect(typeof result.message).toBe("string")
      expect(Array.isArray(result.issues)).toBe(true)
    })

    it("includes issues array even when config is valid", async () => {
      //#given a normal environment
      //#when running config check
      const result = await config.checkConfig()

      //#then issues should be an array (possibly empty)
      expect(Array.isArray(result.issues)).toBe(true)
    })

    it("uses the OPENCODE_CONFIG_DIR profiles tail after module import", async () => {
      const originalConfigDir = process.env.OPENCODE_CONFIG_DIR
      const originalHome = process.env.HOME
      const originalCwd = process.cwd()
      const testRootDir = join(
        tmpdir(),
        `omo-doctor-config-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      )
      const projectDir = join(testRootDir, "project")
      const userConfigPath = join(testRootDir, ".omo", "omo.jsonc")

      try {
        //#given a unified user config whose profile is selected by the OpenCode config directory
        mkdirSync(projectDir, { recursive: true })
        mkdirSync(join(testRootDir, ".omo"), { recursive: true })
        process.env.HOME = testRootDir
        process.env.OPENCODE_CONFIG_DIR = join(testRootDir, "opencode", "profiles", "focused")
        writeFileSync(
          userConfigPath,
          JSON.stringify({
            profiles: {
              focused: {
                "[opencode]": {
                  categories: { deep: { model: "profile-only-model" } },
                },
              },
            },
          }, null, 2) + "\n",
          "utf-8",
        )
        process.chdir(projectDir)

        //#when running the consolidated config check after the module has loaded
        const result = await config.checkConfig()

        //#then the profile overlay is active and the unified user layer is reported
        expect(result.status).toBe("warn")
        expect(result.issues.some((issue) => issue.title === "Invalid category override: deep")).toBe(true)
        expect(normalizePathForAssertion(result.details?.[0] ?? "")).toContain(
          normalizePathForAssertion(userConfigPath),
        )
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

    it("reports invalid ancestor plugin config from the current directory", async () => {
      const originalConfigDir = process.env.OPENCODE_CONFIG_DIR
      const originalHome = process.env.HOME
      const originalCwd = process.cwd()
      const testRootDir = join(
        tmpdir(),
        `omo-doctor-layered-config-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      )
      const projectDir = join(testRootDir, "project")
      const childDir = join(projectDir, "child", "deep")

      try {
        //#given an invalid unified project config in an ancestor directory
        mkdirSync(childDir, { recursive: true })
        mkdirSync(join(projectDir, ".omo"), { recursive: true })
        process.env.HOME = testRootDir
        process.env.OPENCODE_CONFIG_DIR = join(testRootDir, "empty-user-config")
        writeFileSync(
          join(projectDir, ".omo", "omo.jsonc"),
          JSON.stringify({ "[opencode]": { agents: { sisyphus: { model: 123 } } } }, null, 2) + "\n",
          "utf-8",
        )
        process.chdir(childDir)

        //#when checking config from a nested project directory
        const result = await config.checkConfig()

        //#then the ancestor project layer fails validation
        expect(result.status).toBe("fail")
        expect(result.issues.some((issue) => issue.description.includes("agents.sisyphus.model"))).toBe(true)
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

    it("does not flag configured custom providers as unavailable when they exist in opencode.json", async () => {
      const originalConfigDir = process.env.OPENCODE_CONFIG_DIR
      const originalXdgConfig = process.env.XDG_CONFIG_HOME
      const originalXdgCache = process.env.XDG_CACHE_HOME
      const originalHome = process.env.HOME
      const testRootDir = join(
        tmpdir(),
        `omo-doctor-custom-provider-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      )
      const xdgConfigDir = join(testRootDir, "xdg-config")
      const xdgCacheDir = join(testRootDir, "xdg-cache")

      try {
        mkdirSync(join(testRootDir, ".omo"), { recursive: true })
        mkdirSync(join(xdgConfigDir, "opencode"), { recursive: true })
        mkdirSync(join(xdgCacheDir, "opencode"), { recursive: true })

        process.env.HOME = testRootDir
        process.env.XDG_CONFIG_HOME = xdgConfigDir
        process.env.XDG_CACHE_HOME = xdgCacheDir

        writeFileSync(
          join(testRootDir, ".omo", "omo.jsonc"),
          JSON.stringify(
            { "[opencode]": { agents: { sisyphus: { model: "kiro/claude-opus-4-6" } } } },
            null,
            2,
          ) + "\n",
          "utf-8",
        )
        writeFileSync(
          join(xdgConfigDir, "opencode", "opencode.json"),
          JSON.stringify({
            provider: {
              kiro: {
                npm: "@ai-sdk/openai-compatible",
                models: { "claude-opus-4-6": {} },
              },
            },
          }, null, 2) + "\n",
          "utf-8",
        )
        writeFileSync(
          join(xdgCacheDir, "opencode", "models.json"),
          JSON.stringify({
            openai: { models: { "gpt-5.4": {} } },
          }, null, 2) + "\n",
          "utf-8",
        )

        const result = await config.checkConfig()
        const providerIssue = result.issues.find((issue) => issue.title === "Model override uses unavailable provider")

        expect(providerIssue).toBeUndefined()
      } finally {
        rmSync(testRootDir, { recursive: true, force: true })
        if (originalConfigDir === undefined) {
          delete process.env.OPENCODE_CONFIG_DIR
        } else {
          process.env.OPENCODE_CONFIG_DIR = originalConfigDir
        }
        if (originalXdgConfig === undefined) {
          delete process.env.XDG_CONFIG_HOME
        } else {
          process.env.XDG_CONFIG_HOME = originalXdgConfig
        }
        if (originalXdgCache === undefined) {
          delete process.env.XDG_CACHE_HOME
        } else {
          process.env.XDG_CACHE_HOME = originalXdgCache
        }
        if (originalHome === undefined) {
          delete process.env.HOME
        } else {
          process.env.HOME = originalHome
        }
      }
    })

    // regression: issue #4165 — doctor used to falsely flag reasoningEffort: "max"
    // as an "Invalid configuration" error even though the schema and runtime accept it.
    it("does not flag reasoningEffort: 'max' as an invalid configuration", async () => {
      const originalConfigDir = process.env.OPENCODE_CONFIG_DIR
      const originalHome = process.env.HOME
      const originalCwd = process.cwd()
      const testRootDir = join(
        tmpdir(),
        `omo-doctor-reasoning-effort-max-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      )
      const projectDir = join(testRootDir, "project")

      try {
        //#given a unified user config with the supported max reasoning effort
        mkdirSync(projectDir, { recursive: true })
        mkdirSync(join(testRootDir, ".omo"), { recursive: true })
        process.env.HOME = testRootDir
        delete process.env.OPENCODE_CONFIG_DIR
        writeFileSync(
          join(testRootDir, ".omo", "omo.jsonc"),
          JSON.stringify({
            "[opencode]": {
              agents: {
                sisyphus: { reasoningEffort: "max" },
              },
            },
          }, null, 2) + "\n",
          "utf-8",
        )
        process.chdir(projectDir)

        //#when running the consolidated config check
        const result = await config.checkConfig()
        const invalidConfig = result.issues.find((issue) => issue.title === "Invalid configuration")

        //#then the unified config remains valid
        expect(invalidConfig).toBeUndefined()
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
})
