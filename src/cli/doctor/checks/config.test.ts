import { describe, it, expect } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as config from "./config"

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

        expect(result.details?.[0]).toEndWith("/oh-my-openagent.json")
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
