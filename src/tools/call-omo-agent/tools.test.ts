import { describe, expect, test } from "bun:test"
import { createCallOmoAgent } from "./tools"

const TEST_TOOL_CONTEXT = {
  sessionID: "ses-parent",
  messageID: "msg-1",
  agent: "sisyphus",
  abort: new AbortController().signal,
}

describe("call_omo_agent disabled_agents enforcement", () => {
  test("rejects disabled agent from config with clear error", async () => {
    //#given
    const tool = createCallOmoAgent(
      { client: {} } as Parameters<typeof createCallOmoAgent>[0],
      {} as Parameters<typeof createCallOmoAgent>[1],
      ["explore"],
    )

    //#when
    const result = await tool.execute(
      {
        description: "run search",
        prompt: "find implementation",
        subagent_type: "ExPlOrE",
        run_in_background: false,
      },
      TEST_TOOL_CONTEXT,
    )

    //#then
    expect(result).toBe(
      'Error: Agent "ExPlOrE" is disabled via disabled_agents config.',
    )
  })

  test("allows enabled agent even when other agents are disabled", async () => {
    //#given
    const tool = createCallOmoAgent(
      { client: {} } as Parameters<typeof createCallOmoAgent>[0],
      {} as Parameters<typeof createCallOmoAgent>[1],
      ["explore"],
    )

    //#when
    const result = await tool.execute(
      {
        description: "continue session",
        prompt: "read docs",
        subagent_type: "librarian",
        run_in_background: true,
        session_id: "ses-child",
      },
      TEST_TOOL_CONTEXT,
    )

    //#then
    expect(result).toBe(
      "Error: session_id is not supported in background mode. Use run_in_background=false to continue an existing session.",
    )
  })
})
