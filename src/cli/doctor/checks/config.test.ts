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

    it("respects OPENCODE_CONFIG_DIR even when the env var changes after module import", async () => {
      const originalConfigDir = process.env.OPENCODE_CONFIG_DIR
      const testConfigDir = join(
        tmpdir(),
        `omo-doctor-config-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      )

      try {
        mkdirSync(testConfigDir, { recursive: true })
        process.env.OPENCODE_CONFIG_DIR = testConfigDir
        writeFileSync(
          join(testConfigDir, "oh-my-openagent.json"),
          JSON.stringify({ disabled_hooks: ["comment-checker"] }, null, 2) + "\n",
          "utf-8",
        )

        const result = await config.checkConfig()

        expect(normalizePathForAssertion(result.details?.[0] ?? "")).toContain(
          normalizePathForAssertion(join(testConfigDir, "oh-my-openagent.json")),
        )
      } finally {
        rmSync(testConfigDir, { recursive: true, force: true })
        if (originalConfigDir === undefined) {
          delete process.env.OPENCODE_CONFIG_DIR
        } else {
          process.env.OPENCODE_CONFIG_DIR = originalConfigDir
        }
      }
    })

    it("does not flag configured custom providers as unavailable when they exist in opencode.json", async () => {
      const originalConfigDir = process.env.OPENCODE_CONFIG_DIR
      const originalXdgConfig = process.env.XDG_CONFIG_HOME
      const originalXdgCache = process.env.XDG_CACHE_HOME
      const testRootDir = join(
        tmpdir(),
        `omo-doctor-custom-provider-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      )
      const pluginConfigDir = join(testRootDir, "plugin")
      const xdgConfigDir = join(testRootDir, "xdg-config")
      const xdgCacheDir = join(testRootDir, "xdg-cache")

      try {
        mkdirSync(pluginConfigDir, { recursive: true })
        mkdirSync(join(xdgConfigDir, "opencode"), { recursive: true })
        mkdirSync(join(xdgCacheDir, "opencode"), { recursive: true })

        process.env.OPENCODE_CONFIG_DIR = pluginConfigDir
        process.env.XDG_CONFIG_HOME = xdgConfigDir
        process.env.XDG_CACHE_HOME = xdgCacheDir

        writeFileSync(
          join(pluginConfigDir, "oh-my-openagent.json"),
          JSON.stringify({ agents: { sisyphus: { model: "kiro/claude-opus-4-6" } } }, null, 2) + "\n",
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
      }
    })

    // regression: issue #4165 — doctor used to falsely flag reasoningEffort: "max"
    // as an "Invalid configuration" error even though the schema and runtime accept it.
    it("does not flag reasoningEffort: 'max' as an invalid configuration", async () => {
      const originalConfigDir = process.env.OPENCODE_CONFIG_DIR
      const testConfigDir = join(
        tmpdir(),
        `omo-doctor-reasoning-effort-max-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      )

      try {
        mkdirSync(testConfigDir, { recursive: true })
        process.env.OPENCODE_CONFIG_DIR = testConfigDir
        writeFileSync(
          join(testConfigDir, "oh-my-openagent.json"),
          JSON.stringify({
            agents: {
              sisyphus: { reasoningEffort: "max" },
            },
          }, null, 2) + "\n",
          "utf-8",
        )

        const result = await config.checkConfig()
        const invalidConfig = result.issues.find((issue) => issue.title === "Invalid configuration")

        expect(invalidConfig).toBeUndefined()
      } finally {
        rmSync(testConfigDir, { recursive: true, force: true })
        if (originalConfigDir === undefined) {
          delete process.env.OPENCODE_CONFIG_DIR
        } else {
          process.env.OPENCODE_CONFIG_DIR = originalConfigDir
        }
      }
    })
  })
})
