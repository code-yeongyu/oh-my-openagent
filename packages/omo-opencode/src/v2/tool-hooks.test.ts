import { describe, expect, it, mock } from "bun:test"
import type { Hooks } from "@opencode-ai/plugin"
import type { V2ToolAfterEvent, V2ToolBeforeEvent } from "./context-types"
import { createFakePluginContext } from "./fake-plugin-context"
import { installToolHooks } from "./tool-hooks"

type BeforeHook = NonNullable<Hooks["tool.execute.before"]>
type AfterHook = NonNullable<Hooks["tool.execute.after"]>

function beforeEvent(overrides: Partial<V2ToolBeforeEvent> = {}): V2ToolBeforeEvent {
  return { tool: "shell", sessionID: "ses_1", agent: "Sisyphus", messageID: "msg_1", id: "call_1", input: { command: "ls" }, ...overrides }
}

function afterEvent(overrides: Partial<V2ToolAfterEvent> = {}): V2ToolAfterEvent {
  return {
    tool: "read",
    sessionID: "ses_1",
    agent: "Sisyphus",
    messageID: "msg_1",
    id: "call_1",
    input: { path: "/work/app/src/a.ts" },
    status: "completed",
    result: { content: [{ type: "text", text: "const a = 1" }], metadata: { lines: 1 } },
    ...overrides,
  }
}

describe("installToolHooks", () => {
  describe("#given a tool.execute.before hook", () => {
    it("#when a 2.x shell call runs #then the hook sees the 1.x tool name, ids and args, and edits flow back", async () => {
      // given
      const fake = createFakePluginContext()
      const seen: Array<{ input: unknown; args: unknown }> = []
      const hook: BeforeHook = async (input, output) => {
        seen.push({ input, args: structuredClone(output.args) })
        output.args.command = `env CI=1 ${output.args.command}`
      }
      await installToolHooks(fake.context, { "tool.execute.before": hook } as Hooks)

      // when
      const event = await fake.triggerToolBefore(beforeEvent())

      // then
      expect(seen).toEqual([{ input: { tool: "bash", sessionID: "ses_1", callID: "call_1" }, args: { command: "ls" } }])
      expect(event.input).toEqual({ command: "env CI=1 ls" })
      expect(event.tool).toBe("shell")
    })

    it("#when a 2.x file tool uses path #then the hook also sees filePath and a changed filePath updates path", async () => {
      // given
      const fake = createFakePluginContext()
      const seen: unknown[] = []
      const hook: BeforeHook = async (_input, output) => {
        seen.push(structuredClone(output.args))
        output.args.filePath = "/work/redirected.ts"
      }
      await installToolHooks(fake.context, { "tool.execute.before": hook } as Hooks)

      // when
      const event = await fake.triggerToolBefore(beforeEvent({ tool: "write", input: { path: "/work/a.ts", content: "x" } }))

      // then
      expect(seen).toEqual([{ path: "/work/a.ts", content: "x", filePath: "/work/a.ts" }])
      expect(event.input).toEqual({ path: "/work/redirected.ts", content: "x" })
    })

    it("#when the hook leaves filePath alone #then no filePath key leaks into the 2.x input", async () => {
      // given
      const fake = createFakePluginContext()
      const hook: BeforeHook = async () => {}
      await installToolHooks(fake.context, { "tool.execute.before": hook } as Hooks)

      // when
      const event = await fake.triggerToolBefore(beforeEvent({ tool: "read", input: { path: "/work/a.ts" } }))

      // then
      expect(event.input).toEqual({ path: "/work/a.ts" })
    })

    it("#when the hook throws to block the call #then the error propagates to the host unchanged", async () => {
      // given
      const fake = createFakePluginContext()
      const guard: BeforeHook = async () => {
        throw new Error("File already exists. Use edit tool instead.")
      }
      await installToolHooks(fake.context, { "tool.execute.before": guard } as Hooks)

      // when
      const run = fake.triggerToolBefore(beforeEvent({ tool: "write", input: { path: "/work/a.ts", content: "x" } }))

      // then
      await expect(run).rejects.toThrow("File already exists. Use edit tool instead.")
    })
  })

  describe("#given a tool.execute.after hook", () => {
    it("#when a call completed #then the hook sees title, joined text output and metadata, and rewrites flow back", async () => {
      // given
      const fake = createFakePluginContext()
      const seen: unknown[] = []
      const hook: AfterHook = async (input, output) => {
        seen.push({ input, output: structuredClone(output) })
        output.output = `${output.output}\n[truncated]`
        output.metadata = { ...output.metadata, truncated: true }
      }
      await installToolHooks(fake.context, { "tool.execute.after": hook } as Hooks)

      // when
      const event = await fake.triggerToolAfter(afterEvent())

      // then
      expect(seen).toEqual([
        {
          input: {
            tool: "read",
            sessionID: "ses_1",
            callID: "call_1",
            args: { path: "/work/app/src/a.ts", filePath: "/work/app/src/a.ts" },
          },
          output: { title: "src/a.ts", output: "const a = 1", metadata: { lines: 1 } },
        },
      ])
      expect(event.result?.content).toEqual([{ type: "text", text: "const a = 1\n[truncated]" }])
      expect(event.result?.metadata).toEqual({ lines: 1, truncated: true })
    })

    it("#when a file tool's path is outside the worktree or the tool is not a file tool #then the title is the path as given or empty", async () => {
      // given
      const fake = createFakePluginContext()
      const titles: string[] = []
      const hook: AfterHook = async (_input, output) => void titles.push(output.title)
      await installToolHooks(fake.context, { "tool.execute.after": hook } as Hooks)

      // when
      await fake.triggerToolAfter(afterEvent({ input: { path: "/elsewhere/b.ts" } }))
      await fake.triggerToolAfter(afterEvent({ tool: "shell", input: { command: "ls" } }))

      // then
      expect(titles).toEqual(["/elsewhere/b.ts", ""])
    })

    it("#when the result also carries file parts #then a rewritten text keeps them", async () => {
      // given
      const fake = createFakePluginContext()
      const hook: AfterHook = async (_input, output) => {
        output.output = "rewritten"
      }
      await installToolHooks(fake.context, { "tool.execute.after": hook } as Hooks)
      const image = { type: "file", uri: "data:image/png;base64,AAAA", mime: "image/png" }

      // when
      const event = await fake.triggerToolAfter(
        afterEvent({ result: { content: [{ type: "text", text: "see" }, image] } }),
      )

      // then
      expect(event.result?.content).toEqual([{ type: "text", text: "rewritten" }, image])
    })

    it("#when the call errored #then the 1.x after hook is not run, as on 1.x", async () => {
      // given
      const fake = createFakePluginContext()
      const hook = mock(async () => {})
      await installToolHooks(fake.context, { "tool.execute.after": hook } as unknown as Hooks)

      // when
      await fake.triggerToolAfter(afterEvent({ status: "error", result: undefined }))

      // then
      expect(hook).not.toHaveBeenCalled()
    })

    it("#when the hook changes nothing #then the result is left as it was", async () => {
      // given
      const fake = createFakePluginContext()
      await installToolHooks(fake.context, { "tool.execute.after": async () => {} } as Hooks)
      const original = afterEvent()

      // when
      const event = await fake.triggerToolAfter(original)

      // then
      expect(event.result?.content).toEqual([{ type: "text", text: "const a = 1" }])
      expect(event.result?.metadata).toEqual({ lines: 1 })
    })
  })

  describe("#given the registrations", () => {
    it("#when no tool hooks are defined #then nothing is registered", async () => {
      // given
      const fake = createFakePluginContext()

      // when
      await installToolHooks(fake.context, {} as Hooks)

      // then
      expect(fake.toolHookCount()).toBe(0)
    })

    it("#when disposed #then both registrations are removed", async () => {
      // given
      const fake = createFakePluginContext()
      const dispose = await installToolHooks(fake.context, {
        "tool.execute.before": async () => {},
        "tool.execute.after": async () => {},
      } as Hooks)
      expect(fake.toolHookCount()).toBe(2)

      // when
      await dispose()

      // then
      expect(fake.toolHookCount()).toBe(0)
    })
  })
})
