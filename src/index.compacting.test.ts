import { describe, expect, it, mock } from "bun:test"

function createCompactingHandler(hooks: {
  compactionContextInjector?: {
    capture: (sessionID: string) => Promise<void>
    inject: (sessionID: string) => string
  }
  compactionTodoPreserver?: { capture: (sessionID: string) => Promise<void> }
  claudeCodeHooks?: {
    "experimental.session.compacting"?: (
      input: { sessionID: string },
      output: { context: string[] },
    ) => Promise<void>
  }
}) {
  return async (
    input: { sessionID: string },
    output: { context: string[] },
  ): Promise<void> => {
    await hooks.compactionContextInjector?.capture(input.sessionID)
    await hooks.compactionTodoPreserver?.capture(input.sessionID)
    await hooks.claudeCodeHooks?.["experimental.session.compacting"]?.(
      input,
      output,
    )
    if (hooks.compactionContextInjector) {
      output.context.push(hooks.compactionContextInjector.inject(input.sessionID))
    }
  }
}

describe("experimental.session.compacting handler", () => {
  //#given all three hooks are present
  //#when compacting handler is invoked
  //#then all hooks are called in order: capture → PreCompact → contextInjector
  it("calls claudeCodeHooks PreCompact alongside other hooks", async () => {
    const callOrder: string[] = []

    const handler = createCompactingHandler({
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

    const output = { context: [] as string[] }
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
    const handler = createCompactingHandler({
      claudeCodeHooks: {
        "experimental.session.compacting": async (_input, output) => {
          output.context.push("precompact-injected-context")
        },
      },
    })

    const output = { context: [] as string[] }
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

    const handler = createCompactingHandler({
      compactionContextInjector: {
        capture: checkpointCaptureMock,
        inject: contextMock,
      },
      compactionTodoPreserver: { capture: captureMock },
      claudeCodeHooks: undefined,
    })

    const output = { context: [] as string[] }
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

    const handler = createCompactingHandler({
      claudeCodeHooks: {
        "experimental.session.compacting": preCompactMock,
      },
      compactionContextInjector: undefined,
    })

    const output = { context: [] as string[] }
    await handler({ sessionID: "ses_test" }, output)

    expect(preCompactMock).toHaveBeenCalled()
    expect(output.context).toEqual([])
  })
})
