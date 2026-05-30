import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseJsonc } from "../shared/jsonc-parser"
import { CONFIG_BASENAME } from "../shared/plugin-identity"
import { resetConfigContext } from "./config-manager/config-context"
import { enablePlugin, disablePlugin } from "./enable-disable"

describe("enablePlugin / disablePlugin", () => {
  let testConfigDir = ""
  let testConfigPath = ""

  beforeEach(() => {
    testConfigDir = join(tmpdir(), `omo-enable-disable-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    testConfigPath = join(testConfigDir, `${CONFIG_BASENAME}.json`)
    mkdirSync(testConfigDir, { recursive: true })
    process.env.OPENCODE_CONFIG_DIR = testConfigDir
    resetConfigContext()
  })

  afterEach(() => {
    rmSync(testConfigDir, { recursive: true, force: true })
    resetConfigContext()
    delete process.env.OPENCODE_CONFIG_DIR
  })

  describe("#given no existing config file", () => {
    it("#when disablePlugin is called #then writes plugin.enabled=false", () => {
      // when
      const result = disablePlugin()

      // then
      expect(result.success).toBe(true)
      const saved = parseJsonc<Record<string, unknown>>(readFileSync(testConfigPath, "utf-8"))
      const plugin = saved?.plugin as Record<string, unknown> | undefined
      expect(plugin?.enabled).toBe(false)
    })

    it("#when enablePlugin is called #then writes plugin.enabled=true", () => {
      // when
      const result = enablePlugin()

      // then
      expect(result.success).toBe(true)
      const saved = parseJsonc<Record<string, unknown>>(readFileSync(testConfigPath, "utf-8"))
      const plugin = saved?.plugin as Record<string, unknown> | undefined
      expect(plugin?.enabled).toBe(true)
    })
  })

  describe("#given existing config with other fields", () => {
    it("#when disablePlugin is called #then preserves existing fields and sets plugin.enabled=false", () => {
      // given
      writeFileSync(testConfigPath, JSON.stringify({ disabled_hooks: ["comment-checker"] }, null, 2) + "\n")

      // when
      const result = disablePlugin()

      // then
      expect(result.success).toBe(true)
      const saved = parseJsonc<Record<string, unknown>>(readFileSync(testConfigPath, "utf-8"))
      expect(saved?.disabled_hooks).toEqual(["comment-checker"])
      const plugin = saved?.plugin as Record<string, unknown> | undefined
      expect(plugin?.enabled).toBe(false)
    })

    it("#when enablePlugin is called after disablePlugin #then sets plugin.enabled=true", () => {
      // given
      writeFileSync(testConfigPath, JSON.stringify({ plugin: { enabled: false } }, null, 2) + "\n")

      // when
      const result = enablePlugin()

      // then
      expect(result.success).toBe(true)
      const saved = parseJsonc<Record<string, unknown>>(readFileSync(testConfigPath, "utf-8"))
      const plugin = saved?.plugin as Record<string, unknown> | undefined
      expect(plugin?.enabled).toBe(true)
    })
  })
})
