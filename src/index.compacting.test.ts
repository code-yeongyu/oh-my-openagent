import { describe, expect, it, mock } from "bun:test"

import {
  createCompactionAutocontinueHandler,
  createSessionCompactingHandler,
} from "./plugin/session-compacting"

describe("experimental.session.compacting handler", () => {
  //#given all three hooks are present
  //#when compacting handler is invoked
  //#then all hooks are called in order: capture → PreCompact → contextInjector
  it("calls claudeCodeHooks PreCompact alongside other hooks", async () => {
    const callOrder: string[] = []

    const handler = createSessionCompactingHandler({
      compactionContextInjector: {
        capture: mock(async () => {
          callOrder.push("checkpointCapture")
        }),
        inject: mock((sessionID: string) => {
          callOrder.push("contextInjector")
          return `context-for-${sessionID}`
        }),
      },
      compactionTodoPreserver: {
        capture: mock(async () => {
          callOrder.push("capture")
        }),
      },
      claudeCodeHooks: {
        "experimental.session.compacting": mock(async () => {
          callOrder.push("preCompact")
        }),
      },
    })

    const output = { context: [] as string[], prompt: undefined as string | undefined }
    await handler({ sessionID: "ses_test" }, output)

    expect(callOrder).toEqual([
      "checkpointCapture",
      "capture",
      "preCompact",
      "contextInjector",
    ])
    expect(output.context).toEqual(["context-for-ses_test"])
  })

  //#given claudeCodeHooks injects context during PreCompact
  //#when compacting handler is invoked
  //#then injected context from PreCompact is preserved in output
  it("preserves context injected by PreCompact hooks", async () => {
    const handler = createSessionCompactingHandler({
      claudeCodeHooks: {
        "experimental.session.compacting": async (_input, output) => {
          output.context.push("precompact-injected-context")
        },
      },
    })

    const output = { context: [] as string[], prompt: undefined as string | undefined }
    await handler({ sessionID: "ses_test" }, output)

    expect(output.context).toContain("precompact-injected-context")
  })

  //#given claudeCodeHooks is null (no claude code hooks configured)
  //#when compacting handler is invoked
  //#then handler completes without error and other hooks still run
  it("handles null claudeCodeHooks gracefully", async () => {
    const captureMock = mock(async () => {})
    const checkpointCaptureMock = mock(async () => {})
    const contextMock = mock(() => "injected-context")

    const handler = createSessionCompactingHandler({
      compactionContextInjector: {
        capture: checkpointCaptureMock,
        inject: contextMock,
      },
      compactionTodoPreserver: { capture: captureMock },
      claudeCodeHooks: undefined,
    })

    const output = { context: [] as string[], prompt: undefined as string | undefined }
    await handler({ sessionID: "ses_test" }, output)

    expect(checkpointCaptureMock).toHaveBeenCalledWith("ses_test")
    expect(captureMock).toHaveBeenCalledWith("ses_test")
    expect(contextMock).toHaveBeenCalledWith("ses_test")
    expect(output.context).toEqual(["injected-context"])
  })

  //#given compactionContextInjector is null
  //#when compacting handler is invoked
  //#then handler does not early-return, PreCompact hooks still execute
  it("does not early-return when compactionContextInjector is null", async () => {
    const preCompactMock = mock(async () => {})

    const handler = createSessionCompactingHandler({
      claudeCodeHooks: {
        "experimental.session.compacting": preCompactMock,
      },
      compactionContextInjector: undefined,
    })

    const output = { context: [] as string[], prompt: undefined as string | undefined }
    await handler({ sessionID: "ses_test" }, output)

    expect(preCompactMock).toHaveBeenCalled()
    expect(output.context).toEqual([])
  })

  //#given a preservation hook throws while OpenCode is compacting
  //#when compacting handler is invoked
  //#then compaction still continues so the user does not see a failed compact
  it("continues compaction when an internal preservation hook throws", async () => {
    const preCompactMock = mock(async (_input, output: { context: string[] }) => {
      output.context.push("precompact-context")
    })

    const handler = createSessionCompactingHandler({
      compactionContextInjector: {
        capture: mock(async () => {
          throw new Error("checkpoint api down")
        }),
        inject: mock(() => "injected-context"),
      },
      compactionTodoPreserver: {
        capture: mock(async () => {}),
      },
      claudeCodeHooks: {
        "experimental.session.compacting": preCompactMock,
      },
    })

    const output = { context: [] as string[], prompt: undefined as string | undefined }

    await expect(handler({ sessionID: "ses_test" }, output)).resolves.toBeUndefined()
    expect(preCompactMock).toHaveBeenCalled()
    expect(output.context).toContain("precompact-context")
  })

  //#given a PreCompact hook replaces the OpenCode compaction prompt
  //#when compacting handler is invoked
  //#then the prompt replacement is preserved for OpenCode
  it("preserves prompt replacement from PreCompact hooks", async () => {
    const handler = createSessionCompactingHandler({
      claudeCodeHooks: {
        "experimental.session.compacting": mock(async (_input, output) => {
          output.prompt = "custom compaction prompt"
        }),
      },
    })

    const output = { context: [] as string[], prompt: undefined as string | undefined }
    await handler({ sessionID: "ses_prompt" }, output)

    expect(output.prompt).toBe("custom compaction prompt")
  })
})

describe("experimental.compaction.autocontinue handler", () => {
  it("disables OpenCode autocontinue when the compaction agent would continue itself", async () => {
    //#given
    const restoreContextMock = mock(async () => true)
    const restoreTodosMock = mock(async () => {})
    const handler = createCompactionAutocontinueHandler({
      compactionContextInjector: { restore: restoreContextMock },
      compactionTodoPreserver: { restore: restoreTodosMock },
    })
    const output = { enabled: true }

    //#when
    await handler({ sessionID: "ses_compaction_loop", agent: "compaction" }, output)

    //#then
    expect(output.enabled).toBe(false)
    expect(restoreContextMock).not.toHaveBeenCalled()
    expect(restoreTodosMock).not.toHaveBeenCalled()
  })

  it("restores checkpointed context and todos before OpenCode adds the synthetic continue turn", async () => {
    //#given
    const callOrder: string[] = []
    const restoreContextMock = mock(async () => {
      callOrder.push("context")
      return true
    })
    const restoreMock = mock(async () => {})
    const handler = createCompactionAutocontinueHandler({
      compactionContextInjector: { restore: restoreContextMock },
      compactionTodoPreserver: {
        restore: mock(async (sessionID: string) => {
          callOrder.push(`todos:${sessionID}`)
          await restoreMock(sessionID)
        }),
      },
    })
    const output = { enabled: true }

    //#when
    await handler({ sessionID: "ses_autocontinue" }, output)

    //#then
    expect(restoreContextMock).toHaveBeenCalledWith("ses_autocontinue")
    expect(restoreMock).toHaveBeenCalledWith("ses_autocontinue")
    expect(callOrder).toEqual(["context", "todos:ses_autocontinue"])
    expect(output.enabled).toBe(true)
  })

  it("continues autocontinue restore when one restore hook throws", async () => {
    //#given
    const restoreMock = mock(async () => {})
    const handler = createCompactionAutocontinueHandler({
      compactionContextInjector: {
        restore: mock(async () => {
          throw new Error("checkpoint restore failed")
        }),
      },
      compactionTodoPreserver: { restore: restoreMock },
    })
    const output = { enabled: true }

    //#when
    await expect(handler({ sessionID: "ses_autocontinue" }, output)).resolves.toBeUndefined()

    //#then
    expect(restoreMock).toHaveBeenCalledWith("ses_autocontinue")
    expect(output.enabled).toBe(true)
  })
})
