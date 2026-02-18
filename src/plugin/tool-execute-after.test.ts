import { describe, expect, test } from "bun:test"

import type { CreatedHooks } from "../create-hooks"
import { createToolExecuteAfterHandler } from "./tool-execute-after"

describe("createToolExecuteAfterHandler", () => {
  test("runs background tool output notifier in tool.execute.after pipeline", async () => {
    const hooks = {
      backgroundToolOutputNotifier: {
        "tool.execute.after": async (
          _input: { tool: string; sessionID: string; callID: string },
          output: { title: string; output: string; metadata: Record<string, unknown> },
        ) => {
          output.output = `${output.output}\n\n[BACKGROUND TASK UPDATES]`
        },
      },
    } as unknown as CreatedHooks

    const handler = createToolExecuteAfterHandler({ hooks })
    const output = { title: "bash", output: "ok", metadata: {} }

    await handler(
      { tool: "bash", sessionID: "ses_main", callID: "call_1" },
      output,
    )

    expect(output.output).toContain("[BACKGROUND TASK UPDATES]")
  })

  test("keeps output unchanged when background notifier hook is absent", async () => {
    const hooks = {} as unknown as CreatedHooks
    const handler = createToolExecuteAfterHandler({ hooks })
    const output = { title: "read", output: "stable-output", metadata: {} }

    await handler(
      { tool: "read", sessionID: "ses_main", callID: "call_2" },
      output,
    )

    expect(output.output).toBe("stable-output")
  })
})
