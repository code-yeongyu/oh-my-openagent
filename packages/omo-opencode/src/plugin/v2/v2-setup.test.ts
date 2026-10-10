import { describe, expect, test } from "bun:test"
import { runV2Setup } from "./v2-plugin"
import type { Hooks } from "@opencode-ai/plugin"
import type { V2PluginContext } from "./types"
import { createV1CompatClient } from "./client-facade"

function createSetupStubContext(overrides: Partial<V2PluginContext> = {}): V2PluginContext {
  const toolAdds: Array<Record<string, unknown>> = []
  const agentUpdates: Array<[string, Record<string, unknown>]> = []
  const mcpSets: Array<[string, Record<string, unknown>]> = []
  const commandAdds: Array<Record<string, unknown>> = []
  const hooks: Array<{ domain: string; name: string; callback: (event: never) => unknown }> = []

  const context: V2PluginContext & {
    __toolAdds: typeof toolAdds
    __agentUpdates: typeof agentUpdates
    __mcpSets: typeof mcpSets
    __commandAdds: typeof commandAdds
    __hooks: typeof hooks
  } = {
    app: { name: "opencode", version: "test", channel: "beta" },
    location: { directory: "C:\\project" },
    options: {},
    agent: {
      list: async () => ({ data: [] }),
      get: async () => ({}),
      transform: async (callback: (draft: unknown) => void) => {
        callback({
          update: (id: string, update: (agent: Record<string, unknown>) => void) => {
            const agent: Record<string, unknown> = { id }
            update(agent)
            agentUpdates.push([id, agent])
          },
          default: () => {},
        })
        return { dispose: async () => {} }
      },
      reload: async () => {},
    },
    tool: {
      transform: async (callback: (draft: unknown) => void) => {
        callback({
          add: (tool: Record<string, unknown>) => {
            toolAdds.push(tool)
          },
        })
        return { dispose: async () => {} }
      },
      reload: async () => {},
      hook: async <Name extends string>(name: Name, callback: (event: never) => unknown) => {
        hooks.push({ domain: "tool", name, callback })
        return { dispose: async () => {} }
      },
    },
    mcp: {
      list: async () => ({ data: [] }),
      transform: async (callback: (draft: unknown) => void) => {
        callback({
          set: (name: string, config: Record<string, unknown>) => {
            mcpSets.push([name, config])
          },
        })
        return { dispose: async () => {} }
      },
      reload: async () => {},
    },
    skill: {
      list: async () => ({ data: [] }),
      transform: async () => ({ dispose: async () => {} }),
      reload: async () => {},
    },
    command: {
      list: async () => ({ data: [] }),
      transform: async (callback: (draft: unknown) => void) => {
        callback({
          add: (definition: Record<string, unknown>) => {
            commandAdds.push(definition)
          },
        })
        return { dispose: async () => {} }
      },
      reload: async () => {},
    },
    session: {
      list: async () => ({ data: [] }),
      get: async () => ({}),
      create: async () => ({}),
      remove: async () => {},
      prompt: async () => ({}),
      synthetic: async () => ({}),
      interrupt: async () => ({}),
      compact: async () => ({}),
      wait: async () => {},
      context: async () => ({ data: [] }),
      message: async () => ({}),
      switchAgent: async () => {},
      switchModel: async () => {},
      hook: async <Name extends string>(name: Name, callback: (event: never) => unknown) => {
        hooks.push({ domain: "session", name, callback })
        return { dispose: async () => {} }
      },
    },
    shell: {
      hook: async () => ({ dispose: async () => {} }),
    },
    event: {
      subscribe: async function* () {},
    },
    storage: {
      get: async () => undefined,
      set: async () => {},
      remove: async () => {},
    },
    catalog: {
      provider: {
        list: async () => ({ data: [] }),
        get: async () => ({}),
      },
      model: {
        list: async () => ({ data: [] }),
        default: async () => ({}),
      },
      transform: async () => ({ dispose: async () => {} }),
      reload: async () => {},
    },
    plugin: {
      list: async () => ({ data: [] }),
    },
    __toolAdds: toolAdds,
    __agentUpdates: agentUpdates,
    __mcpSets: mcpSets,
    __commandAdds: commandAdds,
    __hooks: hooks,
    ...overrides,
  }
  return context as unknown as V2PluginContext
}

describe("runV2Setup", () => {
  test("#given a V1 hooks chain #when setup runs #then agents, tools, MCP, and commands are registered on the V2 drafts", async () => {
    // given
    const stub = createSetupStubContext()
    const v1Hooks = {
      config: async (config: Record<string, unknown>) => {
        config["agent"] = {
          sisyphus: { prompt: "You are Sisyphus.", mode: "primary", model: "openai/gpt-5.6" },
        }
        config["default_agent"] = "sisyphus"
        config["mcp"] = {
          lsp: { type: "local", command: ["node", "lsp.js"], enabled: true },
        }
        config["command"] = {
          review: { template: "Review the changes.", description: "Review" },
        }
      },
      tool: {
        example_tool: {
          description: "example",
          args: {},
          execute: async () => "ok",
        },
      },
      event: async () => {},
    } as unknown as Hooks
    // when
    const cleanup = await runV2Setup(stub, {
      startV1ServerPlugin: async () => v1Hooks,
    })
    const stubInternals = stub as unknown as {
      __toolAdds: Array<Record<string, unknown>>
      __agentUpdates: Array<[string, Record<string, unknown>]>
      __mcpSets: Array<[string, Record<string, unknown>]>
      __commandAdds: Array<Record<string, unknown>>
    }
    // then
    expect(stubInternals.__agentUpdates).toHaveLength(1)
    expect(stubInternals.__agentUpdates[0][0]).toBe("sisyphus")
    expect(stubInternals.__agentUpdates[0][1]["system"]).toBe("You are Sisyphus.")
    expect(stubInternals.__mcpSets).toEqual([
      ["lsp", { type: "local", command: ["node", "lsp.js"], disabled: false }],
    ])
    expect(stubInternals.__commandAdds).toHaveLength(1)
    expect(stubInternals.__commandAdds[0]["name"]).toBe("review")
    expect(stubInternals.__toolAdds.length).toBeGreaterThanOrEqual(1)
    expect(stubInternals.__toolAdds[0]["name"]).toBe("example_tool")
    expect(typeof cleanup).toBe("function")
    await cleanup?.()
  })

  test("#given a V1 server plugin that throws #when setup runs #then the error propagates after registration cleanup", async () => {
    // given
    const stub = createSetupStubContext()
    // when / then
    expect(
      runV2Setup(stub, {
        startV1ServerPlugin: async () => {
          throw new Error("init failed")
        },
      }),
    ).rejects.toThrow("init failed")
  })
})
