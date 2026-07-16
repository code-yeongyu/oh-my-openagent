import { describe, expect, it } from "bun:test"
import type { PostEditDiagnosticsOutcome } from "@oh-my-opencode/lsp-core/post-edit"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext } from "../../extension/types"
import { createLspComponent, createLspPostEditSessionState, handlePostEditDiagnosticsToolResult } from "./index"

interface WidgetCall {
  readonly key: string
  readonly content: readonly string[] | undefined
  readonly placement: "aboveEditor" | "belowEditor" | undefined
}

interface SessionContext {
  readonly sessionManager: {
    readonly getSessionId: () => string
  }
  readonly ui?: {
    readonly setWidget: (
      key: string,
      content: readonly string[] | undefined,
      options?: { placement?: "aboveEditor" | "belowEditor" },
    ) => void
  }
  readonly updateToolHookStatus?: (message: string) => void
}

interface TestContext {
  readonly pi: FakeExtensionAPI
  readonly ctx: ComponentContext
}

function setup(): TestContext {
  const pi = new FakeExtensionAPI()
  return {
    pi,
    ctx: {
      logger: { info() {}, warn() {}, error() {} },
      config: {
        getFlag(name) {
          return pi.getFlag(name)
        },
      },
    },
  }
}

describe("omo-senpi lsp post-edit diagnostics", () => {
  it("#given post-edit diagnostics with errors #when a write tool result arrives #then model-visible diagnostics are injected", async () => {
    // given
    const event = mutationEvent("src/broken.ts")
    const widgetCalls: WidgetCall[] = []

    // when
    const result = await handlePostEditDiagnosticsToolResult(
      event,
      {
        ui: {
          setWidget(
            key: string,
            content: readonly string[] | undefined,
            options?: { placement?: "aboveEditor" | "belowEditor" },
          ) {
            widgetCalls.push({ key, content, placement: options?.placement })
          },
        },
      },
      async () => "error[typescript] (2322) at 1:13: broken",
    )

    // then
    expect(result?.content?.at(-1)).toEqual({
      type: "text",
      text: "\n\nLSP errors detected in src/broken.ts, please fix:\nerror[typescript] (2322) at 1:13: broken",
    })
    expect(widgetCalls).toEqual([{ key: "omo-senpi-lsp", content: undefined, placement: "belowEditor" }])
  })

  it("#given many mutated files #when post-edit diagnostics run #then shared orchestration dedupes, bounds concurrency, preserves order, and isolates failures", async () => {
    // given
    let active = 0
    let maxActive = 0
    const calls: string[] = []
    const event = {
      type: "tool_result",
      toolCallId: "edit-1",
      toolName: "edit",
      input: {
        filePaths: ["src/a.ts", "src/b.ts", "src/a.ts", "src/c.ts", "src/d.ts", "src/e.ts", "src/f.ts"],
      },
      content: [{ type: "text", text: "Edited files." }],
      isError: false,
    }

    // when
    const result = await handlePostEditDiagnosticsToolResult(
      event,
      sessionContext("parent-session"),
      async (filePath) => {
        active += 1
        maxActive = Math.max(maxActive, active)
        calls.push(filePath)
        await Promise.resolve()
        active -= 1
        if (filePath === "src/c.ts") throw new Error("server exploded")
        if (filePath === "src/e.ts") return "No diagnostics found"
        return `diagnostic for ${filePath}`
      },
      createLspPostEditSessionState(),
    )

    // then
    expect(calls).toEqual(["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/e.ts", "src/f.ts"])
    expect(maxActive).toBe(4)
    expect(result?.content?.slice(1)).toEqual([
      { type: "text", text: "\n\nLSP errors detected in src/a.ts, please fix:\ndiagnostic for src/a.ts" },
      { type: "text", text: "\n\nLSP errors detected in src/b.ts, please fix:\ndiagnostic for src/b.ts" },
      { type: "text", text: "\n\nLSP errors detected in src/c.ts, please fix:\nserver exploded" },
      { type: "text", text: "\n\nLSP errors detected in src/d.ts, please fix:\ndiagnostic for src/d.ts" },
      { type: "text", text: "\n\nLSP errors detected in src/f.ts, please fix:\ndiagnostic for src/f.ts" },
    ])
  })

  it("#given post-edit sessions #when session events fire #then only that session cache resets or deletes", async () => {
    // given
    const calls: string[] = []
    const responses = new Map<string, PostEditDiagnosticsOutcome>([
      ["parent.foo", { kind: "not_configured", extension: ".foo" }],
      ["child.foo", { kind: "not_configured", extension: ".foo" }],
    ])
    const test = setup()
    createLspComponent({
      postEdit: {
        runDiagnostics: async (filePath) => {
          calls.push(filePath)
          return responses.get(filePath) ?? "No diagnostics found"
        },
      },
    }).register(test.pi, test.ctx)

    // when
    await test.pi.dispatch("session_start", {}, sessionContext("parent-session"))
    await test.pi.dispatch("tool_result", mutationEvent("parent.foo"), sessionContext("parent-session"))
    responses.set("parent.foo", "parent diagnostic after reset")
    await test.pi.dispatch("session_start", {}, sessionContext("parent-session"))
    await test.pi.dispatch("tool_result", mutationEvent("parent.foo"), sessionContext("parent-session"))
    await test.pi.dispatch("tool_result", mutationEvent("child.foo"), sessionContext("child-session"))
    await test.pi.dispatch("session_compact", {}, sessionContext("parent-session"))
    await test.pi.dispatch("tool_result", mutationEvent("parent.foo"), sessionContext("parent-session"))
    await test.pi.dispatch("tool_result", mutationEvent("child.foo"), sessionContext("child-session"))
    await test.pi.dispatch("session_shutdown", {}, sessionContext("parent-session"))
    await test.pi.dispatch("tool_result", mutationEvent("parent.foo"), sessionContext("parent-session"))

    // then
    expect(calls).toEqual(["parent.foo", "child.foo", "parent.foo", "parent.foo"])
  })

  it("#given a context with updateToolHookStatus #when post-edit diagnostics run #then the live status label is reported", async () => {
    // given
    const statuses: string[] = []

    // when
    await handlePostEditDiagnosticsToolResult(
      mutationEvent("src/clean.ts"),
      {
        updateToolHookStatus(message: string) {
          statuses.push(message)
        },
      },
      async () => "No diagnostics found",
    )

    // then
    expect(statuses).toEqual(["(OmO) Checking LSP Diagnostics"])
  })

  it("#given a non-mutation tool result #when the post-edit handler runs #then no live status is reported", async () => {
    // given
    const statuses: string[] = []

    // when
    await handlePostEditDiagnosticsToolResult(
      {
        type: "tool_result",
        toolCallId: "bash-1",
        toolName: "bash",
        input: { command: "ls" },
        content: [{ type: "text", text: "ok" }],
        isError: false,
      },
      {
        updateToolHookStatus(message: string) {
          statuses.push(message)
        },
      },
      async () => "No diagnostics found",
    )

    // then
    expect(statuses).toEqual([])
  })

  it("#given post-edit diagnostics are clean #when a write tool result arrives #then no diagnostics are injected", async () => {
    // when
    const result = await handlePostEditDiagnosticsToolResult(
      mutationEvent("src/clean.ts"),
      undefined,
      async () => "No diagnostics found",
    )

    // then
    expect(result).toBeUndefined()
  })
})

function sessionContext(sessionId: string): SessionContext {
  return {
    sessionManager: {
      getSessionId: () => sessionId,
    },
  }
}

function mutationEvent(path: string): {
  readonly type: "tool_result"
  readonly toolCallId: string
  readonly toolName: "write"
  readonly input: { readonly path: string }
  readonly content: readonly { readonly type: "text"; readonly text: string }[]
  readonly isError: false
} {
  return {
    type: "tool_result",
    toolCallId: `write-${path}`,
    toolName: "write",
    input: { path },
    content: [{ type: "text", text: "Wrote file successfully." }],
    isError: false,
  }
}
