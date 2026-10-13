import { describe, expect, it, mock } from "bun:test"
import type { V2AgentInfo, V2ModelInfo } from "../context-types"
import { createFakePluginContext } from "../fake-plugin-context"
import { installConfigBridge } from "./install-config-bridge"

type ConfigHook = Parameters<typeof installConfigBridge>[1]

const build: V2AgentInfo = {
  id: "build",
  name: "build",
  mode: "primary",
  hidden: false,
  permissions: [{ action: "*", resource: "*", effect: "allow" }],
}

const opus: V2ModelInfo = {
  id: "claude-opus",
  modelID: "claude-opus",
  providerID: "anthropic",
  name: "Claude Opus",
  status: "active",
  enabled: true,
  capabilities: { tools: true, input: ["text"], output: ["text"] },
  variants: [],
  limit: { context: 200_000, output: 8_000 },
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 15))

const sisyphusConfig = {
  agent: {
    Sisyphus: { prompt: "You orchestrate.", description: "Main", mode: "primary", color: "#112233", model: "anthropic/claude-opus" },
  },
  default_agent: "Sisyphus",
}

function hookReturning(config: Record<string, unknown>): ConfigHook {
  return async (target) => {
    Object.assign(target, config)
  }
}

describe("installConfigBridge", () => {
  describe("#given a config hook that defines agents", () => {
    it("#when installed #then the agents exist on the host with their mapped fields and the default agent is set", async () => {
      // given
      const fake = createFakePluginContext({ agents: [build] })

      // when
      await installConfigBridge(fake.context, hookReturning(sisyphusConfig), { warn: () => {}, debounceMs: 0 })

      // then
      const sisyphus = fake.builtAgents().get("Sisyphus")
      expect(sisyphus).toMatchObject({
        system: "You orchestrate.",
        description: "Main",
        mode: "primary",
        color: "#112233",
        model: { providerID: "anthropic", id: "claude-opus" },
      })
      expect(fake.defaultAgent()).toBe("Sisyphus")
      expect(fake.builtAgents().has("build")).toBe(true)
    })

    it("#when the config disables an agent #then that agent is removed from the host", async () => {
      // given
      const fake = createFakePluginContext({ agents: [build] })
      const hook = hookReturning({ agent: { build: { disable: true } } })

      // when
      await installConfigBridge(fake.context, hook, { warn: () => {}, debounceMs: 0 })

      // then
      expect(fake.builtAgents().has("build")).toBe(false)
    })
  })

  describe("#given a config hook that defines MCP servers", () => {
    const mcpConfig = {
      mcp: {
        context7: { type: "remote", url: "https://mcp.context7.com/mcp", enabled: true },
        lsp: { type: "local", command: ["node", "lsp.mjs"], enabled: false },
        broken: { type: "ftp" },
      },
    }

    it("#when installed #then valid servers exist on the host in 2.x form and the invalid one is skipped with a warning", async () => {
      // given
      const fake = createFakePluginContext()
      const warn = mock((_message: string) => {})

      // when
      await installConfigBridge(fake.context, hookReturning(mcpConfig), { warn, debounceMs: 0 })

      // then
      expect(fake.builtMcp().get("context7")).toEqual({
        type: "remote",
        url: "https://mcp.context7.com/mcp",
        disabled: false,
        codemode: false,
      })
      expect(fake.builtMcp().get("lsp")).toMatchObject({ type: "local", command: ["node", "lsp.mjs"], disabled: true })
      expect(fake.builtMcp().has("broken")).toBe(false)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0]?.[0]).toContain('"broken"')
    })

    it("#when the hook output changes on a later run #then the MCP registry is reloaded as well", async () => {
      // given
      const fake = createFakePluginContext()
      let round = 0
      const hook: ConfigHook = async (config) => {
        round += 1
        Object.assign(config, { mcp: { stub: { type: "remote", url: `https://example.test/${round}` } } })
      }
      await installConfigBridge(fake.context, hook, { warn: () => {}, debounceMs: 0 })
      const before = fake.mcpReloadCount()

      // when
      fake.emit({ type: "provider.updated" })
      await settle()

      // then
      expect(fake.builtMcp().get("stub")).toMatchObject({ url: "https://example.test/2" })
      expect(fake.mcpReloadCount()).toBe(before + 1)
    })
  })

  describe("#given a config hook that defines commands", () => {
    const commandConfig = {
      command: {
        triage: { template: "Triage: $ARGUMENTS", description: "Triage an issue", agent: "Sisyphus" },
        broken: { description: "no template" },
      },
    }

    it("#when installed #then valid commands exist on the host and the invalid one is skipped with a warning", async () => {
      // given
      const fake = createFakePluginContext()
      const warn = mock((_message: string) => {})

      // when
      await installConfigBridge(fake.context, hookReturning(commandConfig), { warn, debounceMs: 0 })

      // then
      expect([...fake.builtCommands().keys()]).toEqual(["triage"])
      expect(fake.builtCommands().get("triage")?.description).toBe("Triage an issue")
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0]?.[0]).toContain('"broken"')
    })

    it("#when the command runs #then the plugin's before-hook sees it and the session gets the rewritten prompt", async () => {
      // given
      const fake = createFakePluginContext()
      const beforeCommand = mock(async (_input: unknown, output: { parts: Array<{ type: string; text?: string }> }) => {
        output.parts[0] = { type: "text", text: `${output.parts[0]?.text} [hooked]` }
      })

      // when
      await installConfigBridge(fake.context, hookReturning(commandConfig), { warn: () => {}, debounceMs: 0, beforeCommand })
      await fake.builtCommands().get("triage")?.execute({ sessionID: "ses_1", prompt: { text: "login bug" }, delivery: "steer" })

      // then
      expect(beforeCommand).toHaveBeenCalledTimes(1)
      expect(fake.sessionCalls.map((call) => call.kind)).toEqual(["switchAgent", "prompt"])
      expect(fake.sessionCalls[1]).toEqual({
        kind: "prompt",
        input: { sessionID: "ses_1", text: "Triage: login bug [hooked]", delivery: "steer" },
      })
    })

    it("#when the hook output changes on a later run #then the command registry is reloaded too", async () => {
      // given
      const fake = createFakePluginContext()
      let round = 0
      const hook: ConfigHook = async (config) => {
        round += 1
        Object.assign(config, { command: { triage: { template: `round ${round}` } } })
      }
      await installConfigBridge(fake.context, hook, { warn: () => {}, debounceMs: 0 })
      const before = fake.commandReloadCount()

      // when
      fake.emit({ type: "provider.updated" })
      await settle()

      // then
      expect(fake.commandReloadCount()).toBe(before + 1)
    })
  })

  describe("#given the snapshot handed to the config hook", () => {
    it("#when invoked #then it carries the host default model and empty agent, command and mcp maps", async () => {
      // given
      const fake = createFakePluginContext({ models: [opus], defaultModel: opus })
      const seen: Record<string, unknown>[] = []

      // when
      await installConfigBridge(
        fake.context,
        async (config) => void seen.push(structuredClone(config as Record<string, unknown>)),
        { warn: () => {}, debounceMs: 0 },
      )

      // then
      expect(seen[0]).toMatchObject({ model: "anthropic/claude-opus", agent: {}, command: {}, mcp: {} })
    })
  })

  describe("#given global permission and tools rules in the config", () => {
    it("#when installed #then every agent, existing or new, receives them before its own rules", async () => {
      // given
      const fake = createFakePluginContext({ agents: [build] })
      const hook = hookReturning({
        permission: { task: "deny" },
        tools: { "grep_app_*": false },
        agent: { Sisyphus: { permission: { question: "allow" } } },
      })

      // when
      await installConfigBridge(fake.context, hook, { warn: () => {}, debounceMs: 0 })

      // then
      const globalRules = [
        { action: "grep_app_*", resource: "*", effect: "deny" },
        { action: "subagent", resource: "*", effect: "deny" },
      ]
      expect(fake.builtAgents().get("build")?.permissions.slice(-2)).toEqual(globalRules)
      const sisyphus = fake.builtAgents().get("Sisyphus")?.permissions ?? []
      expect(sisyphus.slice(-3)).toEqual([...globalRules, { action: "question", resource: "*", effect: "allow" }])
    })
  })

  describe("#given the host changes after setup", () => {
    it("#when a provider update arrives and the hook output changed #then the agents are refreshed once", async () => {
      // given
      const fake = createFakePluginContext({ agents: [build] })
      let round = 0
      const hook: ConfigHook = async (config) => {
        round += 1
        Object.assign(config, { agent: { Sisyphus: { prompt: `round ${round}` } } })
      }
      await installConfigBridge(fake.context, hook, { warn: () => {}, debounceMs: 0 })
      const reloadsAfterInstall = fake.reloadCount()

      // when
      fake.emit({ type: "provider.updated" })
      await settle()

      // then
      expect(fake.builtAgents().get("Sisyphus")?.system).toBe("round 2")
      expect(fake.reloadCount()).toBe(reloadsAfterInstall + 1)
    })

    it("#when the refreshed output is identical #then the host is not reloaded again", async () => {
      // given
      const fake = createFakePluginContext({ agents: [build] })
      await installConfigBridge(fake.context, hookReturning(sisyphusConfig), { warn: () => {}, debounceMs: 0 })
      const reloadsAfterInstall = fake.reloadCount()

      // when
      fake.emit({ type: "model.updated" })
      await settle()

      // then
      expect(fake.reloadCount()).toBe(reloadsAfterInstall)
    })

    it("#when an unrelated event arrives #then the config hook is not run again", async () => {
      // given
      const fake = createFakePluginContext({ agents: [build] })
      const hook = mock(async (_config: unknown) => {})
      await installConfigBridge(fake.context, hook as ConfigHook, { warn: () => {}, debounceMs: 0 })

      // when
      fake.emit({ type: "session.idle" })
      await settle()

      // then
      expect(hook).toHaveBeenCalledTimes(1)
    })
  })

  describe("#given the installed bridge is disposed", () => {
    it("#when disposed #then the event subscription ends and later events change nothing", async () => {
      // given
      const fake = createFakePluginContext({ agents: [build] })
      const hook = mock(async (_config: unknown) => {})
      const dispose = await installConfigBridge(fake.context, hook as ConfigHook, { warn: () => {}, debounceMs: 0 })
      expect(fake.activeSubscribers()).toBe(1)

      // when
      await dispose()
      fake.emit({ type: "provider.updated" })
      await settle()

      // then
      expect(fake.activeSubscribers()).toBe(0)
      expect(hook).toHaveBeenCalledTimes(1)
    })
  })

  describe("#given a config hook that throws", () => {
    it("#when installed #then setup does not fail, a warning is logged, and the host agents are untouched", async () => {
      // given
      const fake = createFakePluginContext({ agents: [build] })
      const warn = mock((_message: string) => {})
      const failing: ConfigHook = async () => {
        throw new Error("config exploded")
      }

      // when
      const install = installConfigBridge(fake.context, failing, { warn, debounceMs: 0 })

      // then
      await expect(install).resolves.toBeFunction()
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0]?.[0]).toContain("config exploded")
      expect([...fake.builtAgents().keys()]).toEqual(["build"])
    })
  })
})
