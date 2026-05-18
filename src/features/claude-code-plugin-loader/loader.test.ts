import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test"
import {
  clearPluginComponentsCache,
  loadAllPluginComponents,
  loadAllPluginComponentsWithDeps,
  type PluginComponentsResult,
} from "./loader"

function createPluginComponentsResult(): PluginComponentsResult {
  return {
    commands: { "demo:command": { name: "demo:command", description: "demo", template: "demo" } },
    skills: { "demo:skill": { name: "demo:skill", description: "skill", template: "skill" } },
    agents: { "demo:agent": { description: "agent", mode: "subagent", prompt: "demo" } },
    mcpServers: { "demo:mcp": { type: "local", command: ["demo"] } },
    hooksConfigs: [{ hooks: {} }],
    plugins: [{ name: "demo", version: "1.0.0", scope: "user", installPath: "/tmp/demo", pluginKey: "demo@test" }],
    errors: [],
  }
}

describe("loadAllPluginComponents", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.OPENCODE_DISABLE_CLAUDE_CODE
    delete process.env.OPENCODE_DISABLE_CLAUDE_CODE_PLUGINS
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    mock.restore()
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

  describe("when plugin loading repeats with the same options", () => {
    it("returns the cached result without reloading plugin dependencies", async () => {
      // given
      const result = createPluginComponentsResult()
      const discoverInstalledPlugins = mock(() => ({ plugins: result.plugins, errors: result.errors }))
      const loadPluginCommands = mock(() => result.commands)
      const loadPluginSkillsAsCommands = mock(() => result.skills)
      const loadPluginAgents = mock(() => result.agents)
      const loadPluginMcpServers = mock(async () => result.mcpServers)
      const loadPluginHooksConfigs = mock(() => result.hooksConfigs)

      clearPluginComponentsCache()
      const enabledPluginsOverride = { "demo@test": true }

      // when
      const deps = {
        discoverInstalledPlugins,
        loadPluginCommands,
        loadPluginSkillsAsCommands,
        loadPluginAgents,
        loadPluginMcpServers,
        loadPluginHooksConfigs,
      }
      const firstResult = await loadAllPluginComponentsWithDeps({ enabledPluginsOverride }, deps)
      const secondResult = await loadAllPluginComponentsWithDeps({ enabledPluginsOverride }, deps)

      // then
      expect(firstResult).toEqual(result)
      expect(secondResult).toEqual(result)
      expect(discoverInstalledPlugins).toHaveBeenCalledTimes(1)
      expect(loadPluginCommands).toHaveBeenCalledTimes(1)
      expect(loadPluginSkillsAsCommands).toHaveBeenCalledTimes(1)
      expect(loadPluginAgents).toHaveBeenCalledTimes(1)
      expect(loadPluginMcpServers).toHaveBeenCalledTimes(1)
      expect(loadPluginHooksConfigs).toHaveBeenCalledTimes(1)
    })
  })

  describe("when the enabled plugin override changes", () => {
    it("reloads plugin components for the new cache key", async () => {
      // given
      const result = createPluginComponentsResult()
      const discoverInstalledPlugins = mock(() => ({ plugins: result.plugins, errors: result.errors }))
      const loadPluginCommands = mock(() => result.commands)
      const loadPluginSkillsAsCommands = mock(() => result.skills)
      const loadPluginAgents = mock(() => result.agents)
      const loadPluginMcpServers = mock(async () => result.mcpServers)
      const loadPluginHooksConfigs = mock(() => result.hooksConfigs)

      clearPluginComponentsCache()

      // when
      const deps = {
        discoverInstalledPlugins,
        loadPluginCommands,
        loadPluginSkillsAsCommands,
        loadPluginAgents,
        loadPluginMcpServers,
        loadPluginHooksConfigs,
      }
      await loadAllPluginComponentsWithDeps({ enabledPluginsOverride: { "demo@test": true } }, deps)
      await loadAllPluginComponentsWithDeps({ enabledPluginsOverride: { "demo@test": false } }, deps)

      // then
      expect(discoverInstalledPlugins).toHaveBeenCalledTimes(2)
      expect(loadPluginCommands).toHaveBeenCalledTimes(2)
      expect(loadPluginSkillsAsCommands).toHaveBeenCalledTimes(2)
      expect(loadPluginAgents).toHaveBeenCalledTimes(2)
      expect(loadPluginMcpServers).toHaveBeenCalledTimes(2)
      expect(loadPluginHooksConfigs).toHaveBeenCalledTimes(2)
    })
  })

  describe("when the cache is cleared", () => {
    it("reloads plugin components on the next call", async () => {
      // given
      const result = createPluginComponentsResult()
      const discoverInstalledPlugins = mock(() => ({ plugins: result.plugins, errors: result.errors }))
      const loadPluginCommands = mock(() => result.commands)
      const loadPluginSkillsAsCommands = mock(() => result.skills)
      const loadPluginAgents = mock(() => result.agents)
      const loadPluginMcpServers = mock(async () => result.mcpServers)
      const loadPluginHooksConfigs = mock(() => result.hooksConfigs)

      clearPluginComponentsCache()

      // when
      const deps = {
        discoverInstalledPlugins,
        loadPluginCommands,
        loadPluginSkillsAsCommands,
        loadPluginAgents,
        loadPluginMcpServers,
        loadPluginHooksConfigs,
      }
      await loadAllPluginComponentsWithDeps(undefined, deps)
      clearPluginComponentsCache()
      await loadAllPluginComponentsWithDeps(undefined, deps)

      // then
      expect(discoverInstalledPlugins).toHaveBeenCalledTimes(2)
      expect(loadPluginCommands).toHaveBeenCalledTimes(2)
      expect(loadPluginSkillsAsCommands).toHaveBeenCalledTimes(2)
      expect(loadPluginAgents).toHaveBeenCalledTimes(2)
      expect(loadPluginMcpServers).toHaveBeenCalledTimes(2)
      expect(loadPluginHooksConfigs).toHaveBeenCalledTimes(2)
    })
  })

  describe("when a caller mutates a cached result", () => {
    it("returns a fresh clone on the next cache hit", async () => {
      // given
      const result = createPluginComponentsResult()
      const discoverInstalledPlugins = mock(() => ({ plugins: result.plugins, errors: result.errors }))
      const loadPluginCommands = mock(() => result.commands)
      const loadPluginSkillsAsCommands = mock(() => result.skills)
      const loadPluginAgents = mock(() => result.agents)
      const loadPluginMcpServers = mock(async () => result.mcpServers)
      const loadPluginHooksConfigs = mock(() => result.hooksConfigs)

      clearPluginComponentsCache()

      // when
      const deps = {
        discoverInstalledPlugins,
        loadPluginCommands,
        loadPluginSkillsAsCommands,
        loadPluginAgents,
        loadPluginMcpServers,
        loadPluginHooksConfigs,
      }
      const firstResult = await loadAllPluginComponentsWithDeps(undefined, deps)
      firstResult.commands["demo:command"]!.description = "mutated"
      const secondResult = await loadAllPluginComponentsWithDeps(undefined, deps)

      // then
      expect(secondResult.commands["demo:command"]!.description).toBe("demo")
      expect(discoverInstalledPlugins).toHaveBeenCalledTimes(1)
    })
  })
})
