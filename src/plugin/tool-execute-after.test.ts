import { beforeEach, describe, expect, it } from "bun:test"

import { clearPendingStore, storeToolMetadata } from "../features/tool-metadata-store"
import { createToolExecuteAfterHandler } from "./tool-execute-after"

describe("createToolExecuteAfterHandler", () => {
  beforeEach(() => {
    clearPendingStore()
  })

  it("#given truncator changes output #when tool.execute.after runs #then claudeCodeHooks receives truncated output", async () => {
    const callOrder: string[] = []
    let claudeSawOutput = ""

    const handler = createToolExecuteAfterHandler({
      ctx: { directory: "/repo" } as never,
      hooks: {
        toolOutputTruncator: {
          "tool.execute.after": async (_input, output) => {
            callOrder.push("truncator")
            output.output = "truncated output"
          },
        },
        claudeCodeHooks: {
          "tool.execute.after": async (_input, output) => {
            callOrder.push("claude")
            claudeSawOutput = output.output
          },
        },
      } as never,
    })

    await handler(
      { tool: "hashline_edit", sessionID: "ses_test", callID: "call_test" },
      { title: "result", output: "original output", metadata: {} }
    )

    expect(callOrder).toEqual(["truncator", "claude"])
    expect(claudeSawOutput).toBe("truncated output")
  })

  it("#given stored metadata with legacy call id casing #when tool.execute.after runs #then it restores the stored metadata", async () => {
    // given
    storeToolMetadata("ses_parent", "call_legacy", {
      title: "stored title",
      metadata: { sessionId: "ses_child", agent: "oracle" },
    })

    const handler = createToolExecuteAfterHandler({
      ctx: { directory: "/repo" } as never,
      hooks: {} as never,
    })

    const output = { title: "result", output: "original output", metadata: { truncated: true } }

    // when
    await handler(
      { tool: "hashline_edit", sessionID: "ses_parent", callId: " call_legacy " },
      output
    )

    // then
    expect(output.title).toBe("stored title")
    expect(output.metadata).toEqual({ truncated: true, sessionId: "ses_child", agent: "oracle" })
  })

  it("#given native session metadata #when stored metadata exists #then stored metadata does not overwrite native session linkage", async () => {
    // given
    storeToolMetadata("ses_parent", "call_native", {
      title: "stored title",
      metadata: { sessionId: "ses_stored", agent: "oracle" },
    })

    const handler = createToolExecuteAfterHandler({
      ctx: { directory: "/repo" } as never,
      hooks: {} as never,
    })

    const output = {
      title: "result",
      output: "original output",
      metadata: { sessionId: "ses_native", agent: "hephaestus" },
    }

    // when
    await handler(
      { tool: "hashline_edit", sessionID: "ses_parent", callID: "call_native" },
      output
    )

    // then
    expect(output.title).toBe("stored title")
    expect(output.metadata).toEqual({ sessionId: "ses_native", agent: "hephaestus" })
  })
})
