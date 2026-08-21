import { describe, expect, test } from "bun:test"
import type { V2PluginContext, V2ToolDomain } from "./types"
import { createV2PluginModule } from "./create-v2-plugin"

function createToolDomainStub(): V2ToolDomain & { registered: unknown[]; beforeHooks: unknown[]; afterHooks: unknown[] } {
  const extended = {
    registered: [] as unknown[],
    beforeHooks: [] as unknown[],
    afterHooks: [] as unknown[],
    transform: async (callback: (draft: { add(tool: unknown): void }) => void) => {
      callback({ add: (tool: unknown) => extended.registered.push(tool) })
      return { dispose: async () => {} }
    },
    hook: (async (name: string, callback: unknown) => {
      if (name === "execute.before") extended.beforeHooks.push(callback)
      if (name === "execute.after") extended.afterHooks.push(callback)
      return { dispose: async () => {} }
    }) as V2ToolDomain["hook"],
  }
  return extended
}

function createContextStub(overrides: Partial<V2PluginContext> = {}): V2PluginContext & { tool: ReturnType<typeof createToolDomainStub> } {
  const tool = createToolDomainStub()
  return {
    app: { name: "cli", version: "0.0.0-beta-17778", channel: "beta" },
    options: {},
    agent: {} as V2PluginContext["agent"],
    command: {} as V2PluginContext["command"],
    event: {
      subscribe: () => ({
        [Symbol.asyncIterator]: async function* () {},
      }),
    },
    mcp: {} as V2PluginContext["mcp"],
    session: {} as V2PluginContext["session"],
    skill: {} as V2PluginContext["skill"],
    tool,
    ...overrides,
  } as V2PluginContext & { tool: ReturnType<typeof createToolDomainStub> }
}

describe("create-v2-plugin", () => {
  describe("#given the module factory", () => {
    test("exposes the omo plugin id and a setup function", () => {
      // given
      const plugin = createV2PluginModule()
      // then
      expect(plugin.id).toBe("oh-my-openagent")
      expect(typeof plugin.setup).toBe("function")
    })
  })

  describe("#given a healthy v2 context", () => {
    test("setup registers tool lifecycle hooks and returns a composed cleanup", async () => {
      // given
      const context = createContextStub()
      const plugin = createV2PluginModule()
      // when
      const cleanup = await plugin.setup(context)
      // then
      expect(context.tool.beforeHooks.length).toBe(1)
      expect(context.tool.afterHooks.length).toBe(1)
      expect(typeof cleanup).toBe("function")
    })

    test("execute.before bridge strips mcp_ prefix and maps args container", async () => {
      // given
      const context = createContextStub()
      const plugin = createV2PluginModule()
      await plugin.setup(context)
      const beforeHook = context.tool.beforeHooks[0] as (input: Record<string, unknown>) => Promise<void>
      // when
      const event = { tool: "mcp_background_output", sessionID: "ses_1", agent: "a", messageID: "m", id: "c1", input: { taskId: "t" } }
      await beforeHook(event)
      // then
      expect(event.tool).toBe("background_output")
    })

    test("execute.before bridge strips null bytes from bash commands", async () => {
      // given
      const context = createContextStub()
      const plugin = createV2PluginModule()
      await plugin.setup(context)
      const beforeHook = context.tool.beforeHooks[0] as (input: Record<string, unknown>) => Promise<void>
      // when
      const event = { tool: "bash", sessionID: "s", agent: "a", messageID: "m", id: "c", input: { command: "echo hi\x00" } }
      await beforeHook(event)
      // then
      expect((event.input as { command: string }).command).toBe("echo hi")
    })

    test("execute.after bridge tolerates error-status events without throwing", async () => {
      // given
      const context = createContextStub()
      const plugin = createV2PluginModule()
      await plugin.setup(context)
      const afterHook = context.tool.afterHooks[0] as (input: Record<string, unknown>) => Promise<void>
      // then
      await afterHook({ tool: "bash", status: "error", error: new Error("boom"), result: undefined })
    })
  })

  describe("#given a failing domain registration", () => {
    test("setup isolates the failure and still registers the remaining domains", async () => {
      // given
      const context = createContextStub({
        event: {
          subscribe: () => {
            throw new Error("event domain exploded")
          },
        } as unknown as V2PluginContext["event"],
      })
      const plugin = createV2PluginModule()
      // when
      const cleanup = await plugin.setup(context)
      // then
      expect(context.tool.beforeHooks.length).toBe(1)
      expect(typeof cleanup).toBe("function")
    })
  })

  describe("#given cleanup", () => {
    test("composed cleanup disposes every registration exactly once", async () => {
      // given
      let active = 0
      const context = createContextStub()
      context.tool.hook = (async () => {
        active++
        return { dispose: async () => { active-- } }
      }) as unknown as V2ToolDomain["hook"]
      const plugin = createV2PluginModule()
      const cleanup = await plugin.setup(context)
      // when
      const dispose = cleanup as () => Promise<void>
      await dispose()
      await dispose()
      // then
      expect(active).toBe(0)
    })
  })
})
