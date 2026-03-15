declare const describe: (name: string, fn: () => void) => void
declare const it: (name: string, fn: () => void | Promise<void>) => void
declare const expect: (actual: unknown) => {
  toEqual(expected: unknown): void
  toBe(expected: unknown): void
}

import { createToolExecuteAfterHandler } from "./tool-execute-after"

describe("createToolExecuteAfterHandler", () => {
  it("#given truncator changes output #when tool.execute.after runs #then claudeCodeHooks receives truncated output", async () => {
    const callOrder: string[] = []
    let claudeSawOutput = ""

    const handler = createToolExecuteAfterHandler({
      ctx: { directory: "/repo" } as never,
      hooks: {
        toolOutputTruncator: {
          "tool.execute.after": async (
            _input: { tool: string; sessionID: string; callID: string },
            output: { title: string; output: string; metadata: Record<string, unknown> },
          ) => {
            callOrder.push("truncator")
            output.output = "truncated output"
          },
        },
        claudeCodeHooks: {
          "tool.execute.after": async (
            _input: { tool: string; sessionID: string; callID: string },
            output: { title: string; output: string; metadata: Record<string, unknown> },
          ) => {
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

  it("sanitizes MCP content text payloads", async () => {
    const handler = createToolExecuteAfterHandler({
      ctx: { directory: "/repo" } as never,
      hooks: {} as never,
    })

    const payload = {
      title: "result",
      output: "ok",
      metadata: {},
      content: [
        { type: "text", text: `before${String.fromCharCode(0xd800)}after` },
        { type: "resource", uri: "file:///tmp/demo" },
      ],
    }

    await handler(
      { tool: "mcp__demo__tool", sessionID: "ses_test", callID: "call_test" },
      payload,
    )

    expect(payload.content[0]).toEqual({ type: "text", text: "before\uFFFDafter" })
    expect(payload.content[1]).toEqual({ type: "resource", uri: "file:///tmp/demo" })
  })
})
