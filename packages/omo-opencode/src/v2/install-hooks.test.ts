import { describe, expect, it, mock } from "bun:test"
import { tool } from "@opencode-ai/plugin/tool"
import type { Hooks } from "@opencode-ai/plugin"
import type { V2PluginContext, V2Registration, V2ToolEditor, V2ToolInfo } from "./context-types"
import { installHooks } from "./install-hooks"

function createFakeContext() {
  const added: V2ToolInfo[] = []
  const dispose = mock(async () => {})
  const transform = mock(async (callback: (editor: V2ToolEditor) => void): Promise<V2Registration> => {
    callback({ add: (info) => void added.push(info) })
    return { dispose }
  })
  const context: V2PluginContext = {
    app: { name: "cli", version: "2.0.28", channel: "latest" },
    location: {
      directory: "/work/app",
      project: { id: "proj_1", directory: "/work/app", canonical: "/work/app" },
    },
    options: {},
    tool: { transform },
  }
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
