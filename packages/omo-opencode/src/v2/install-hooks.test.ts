import { describe, expect, it, mock } from "bun:test"
import { tool } from "@opencode-ai/plugin/tool"
import type { Hooks } from "@opencode-ai/plugin"
import type { V2PluginContext, V2Registration, V2ToolEditor, V2ToolInfo } from "./context-types"
import { createFakePluginContext } from "./fake-plugin-context"
import { installHooks } from "./install-hooks"

function createFakeContext() {
  const added: V2ToolInfo[] = []
  const dispose = mock(async () => {})
  const transform = mock(async (callback: (editor: V2ToolEditor) => void): Promise<V2Registration> => {
    callback({ add: (info) => void added.push(info) })
    return { dispose }
  })
  const context: V2PluginContext = { ...createFakePluginContext().context, tool: { transform } }
  return { context, added, transform, dispose }
}

const echo = tool({
  description: "Echo",
  args: { text: tool.schema.string() },
  execute: async (args) => args.text,
})

describe("installHooks", () => {
  describe("#given V1 hooks that define tools", () => {
    it("#when installed #then every tool is added through one 2.x tool transform", async () => {
      // given
      const { context, added, transform } = createFakeContext()
      const hooks: Hooks = { tool: { echo, shout: echo } }

      // when
      await installHooks(context, hooks, { warn: () => {} })

      // then
      expect(transform).toHaveBeenCalledTimes(1)
      expect(added.map((info) => info.name)).toEqual(["echo", "shout"])
      expect(added[0]?.options).toEqual({ codemode: false })
    })

    it("#when the returned disposer runs #then the tool registration is disposed once", async () => {
      // given
      const { context, dispose } = createFakeContext()
      const uninstall = await installHooks(context, { tool: { echo } }, { warn: () => {} })

      // when
      await uninstall()
      await uninstall()

      // then
      expect(dispose).toHaveBeenCalledTimes(1)
    })
  })

  describe("#given one tool whose input schema cannot be converted", () => {
    it("#when installed #then only that tool is skipped, named in a warning, and the others register", async () => {
      // given
      const { context, added } = createFakeContext()
      const broken = { description: "broken", args: { oops: 5 }, execute: async () => "x" } as unknown as typeof echo
      const warn = mock((_message: string) => {})

      // when
      await installHooks(context, { tool: { before: echo, broken, after: echo } }, { warn })

      // then
      expect(added.map((info) => info.name)).toEqual(["before", "after"])
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0]?.[0]).toContain('"broken"')
    })
  })

  describe("#given a V1 config hook that defines agents", () => {
    it("#when installed #then the hook runs once and its agents exist on the host until disposed", async () => {
      // given
      const fake = createFakePluginContext()
      const configHook = mock(async (config: Record<string, unknown>) => {
        Object.assign(config, { agent: { Sisyphus: { prompt: "You orchestrate." } } })
      })
      const hooks = { config: configHook } as unknown as Hooks

      // when
      const uninstall = await installHooks(fake.context, hooks, { warn: () => {} })

      // then
      expect(configHook).toHaveBeenCalledTimes(1)
      expect(fake.builtAgents().get("Sisyphus")?.system).toBe("You orchestrate.")

      // when
      await uninstall()

      // then
      expect(fake.activeSubscribers()).toBe(0)
    })
  })

  describe("#given V1 tool execute hooks", () => {
    it("#when installed #then they run around 2.x tool calls until disposed", async () => {
      // given
      const fake = createFakePluginContext()
      const seen: string[] = []
      const hooks = {
        "tool.execute.before": async (input: { tool: string }) => void seen.push(`before:${input.tool}`),
        "tool.execute.after": async (input: { tool: string }) => void seen.push(`after:${input.tool}`),
      } as unknown as Hooks
      const uninstall = await installHooks(fake.context, hooks, { warn: () => {} })

      // when
      await fake.triggerToolBefore({ tool: "shell", sessionID: "s", agent: "a", messageID: "m", id: "c", input: {} })
      await fake.triggerToolAfter({ tool: "shell", sessionID: "s", agent: "a", messageID: "m", id: "c", input: {}, status: "completed", result: { content: [] } })
      await uninstall()

      // then
      expect(seen).toEqual(["before:bash", "after:bash"])
      expect(fake.toolHookCount()).toBe(0)
    })
  })

  describe("#given V1 hooks without tools", () => {
    it("#when installed #then no tool transform is registered", async () => {
      // given
      const { context, transform } = createFakeContext()

      // when
      await installHooks(context, {}, { warn: () => {} })

      // then
      expect(transform).not.toHaveBeenCalled()
    })
  })
})
