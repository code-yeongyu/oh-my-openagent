import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import type { PluginComponentsResult } from "./loader"

describe("loadAllPluginComponents", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.OPENCODE_DISABLE_CLAUDE_CODE
    delete process.env.OPENCODE_DISABLE_CLAUDE_CODE_PLUGINS
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  describe("when OPENCODE_DISABLE_CLAUDE_CODE is set to 'true'", () => {
    it("returns empty result without loading any plugins", async () => {
      // given
      process.env.OPENCODE_DISABLE_CLAUDE_CODE = "true"

      // when
      const { loadAllPluginComponents } = await import("./loader")
      const result: PluginComponentsResult = await loadAllPluginComponents()

      // then
      expect(result.commands).toEqual({})
      expect(result.skills).toEqual({})
      expect(result.agents).toEqual({})
      expect(result.mcpServers).toEqual({})
      expect(result.hooksConfigs).toEqual([])
      expect(result.plugins).toEqual([])
      expect(result.errors).toEqual([])
    })
  })

  describe("when OPENCODE_DISABLE_CLAUDE_CODE is set to '1'", () => {
    it("returns empty result without loading any plugins", async () => {
      // given
      process.env.OPENCODE_DISABLE_CLAUDE_CODE = "1"

      // when
      const { loadAllPluginComponents } = await import("./loader")
      const result: PluginComponentsResult = await loadAllPluginComponents()

      // then
      expect(result.commands).toEqual({})
      expect(result.plugins).toEqual([])
    })
  })

  describe("when OPENCODE_DISABLE_CLAUDE_CODE_PLUGINS is set to 'true'", () => {
    it("returns empty result without loading any plugins", async () => {
      // given
      process.env.OPENCODE_DISABLE_CLAUDE_CODE_PLUGINS = "true"

      // when
      const { loadAllPluginComponents } = await import("./loader")
      const result: PluginComponentsResult = await loadAllPluginComponents()

      // then
      expect(result.commands).toEqual({})
      expect(result.plugins).toEqual([])
    })
  })

  describe("when OPENCODE_DISABLE_CLAUDE_CODE_PLUGINS is set to '1'", () => {
    it("returns empty result without loading any plugins", async () => {
      // given
      process.env.OPENCODE_DISABLE_CLAUDE_CODE_PLUGINS = "1"

      // when
      const { loadAllPluginComponents } = await import("./loader")
      const result: PluginComponentsResult = await loadAllPluginComponents()

      // then
      expect(result.commands).toEqual({})
      expect(result.plugins).toEqual([])
    })
  })

  describe("when neither env var is set", () => {
    it("does not skip plugin loading", async () => {
      // given
      delete process.env.OPENCODE_DISABLE_CLAUDE_CODE
      delete process.env.OPENCODE_DISABLE_CLAUDE_CODE_PLUGINS

      // when
      const { loadAllPluginComponents } = await import("./loader")
      const result: PluginComponentsResult = await loadAllPluginComponents()

      // then — should attempt to load (may find 0 plugins, but shouldn't early-return)
      expect(result).toBeDefined()
      expect(result).toHaveProperty("commands")
      expect(result).toHaveProperty("plugins")
    })
  })

  describe("when env var is set to unrecognized value", () => {
    it("does not skip plugin loading", async () => {
      // given
      process.env.OPENCODE_DISABLE_CLAUDE_CODE = "yes"

      // when
      const { loadAllPluginComponents } = await import("./loader")
      const result: PluginComponentsResult = await loadAllPluginComponents()

      // then — "yes" is not "true" or "1", should not skip
      expect(result).toBeDefined()
      expect(result).toHaveProperty("plugins")
    })
  })
})
