import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { createBuiltinAgents } from "./builtin-agents"
import { ATHENA_JUNIOR_COUNCIL_MEMBER_KEY_PREFIX } from "./builtin-agents/council-member-agents"
import * as shared from "../shared"

const TEST_DEFAULT_MODEL = "anthropic/claude-opus-4-6"
const TEST_COUNCIL_CONFIG = {
  members: [
    { model: "openai/gpt-5.4", name: "Alpha" },
    { model: "anthropic/claude-opus-4-6", name: "Beta" },
  ],
  retry_on_fail: 0,
  retry_failed_if_others_finished: false,
  cancel_retrying_on_quorum: true,
  stuck_threshold_seconds: 120,
  member_max_running_seconds: 1800,
};

describe("createBuiltinAgents Athena-Junior council member mode propagation", () => {
  let fetchSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(
      new Set(["openai/gpt-5.4", TEST_DEFAULT_MODEL])
    )
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it("passes solo mode from Athena-Junior config to registered council members", async () => {
    const agents = await createBuiltinAgents(
      [],
      {
        athena: { model: TEST_DEFAULT_MODEL },
        "athena-junior": { model: TEST_DEFAULT_MODEL },
      },
      undefined,
      TEST_DEFAULT_MODEL,
      undefined,
      undefined,
      [],
      {},
      undefined,
      undefined,
      undefined,
      false,
      TEST_COUNCIL_CONFIG,
      false,
      false,
      { non_interactive_mode: "solo" }
    )

    const agent = agents[`${ATHENA_JUNIOR_COUNCIL_MEMBER_KEY_PREFIX}alpha`]
    const tools = agent.tools as Record<string, boolean>
    const permission = agent.permission as Record<string, string>

    expect(tools.finish_task).toBe(true)
    expect(tools.background_wait).toBe(true)
    expect(tools.read).toBe(false)
    expect(tools.call_omo_agent).toBe(false)
    expect(tools.background_output).toBe(false)
    expect(tools.background_cancel).toBe(false)
    expect(permission.finish_task).toBe("allow")
    expect(permission.read).toBe("deny")
  })

  it("passes delegation mode from Athena-Junior config to registered council members", async () => {
    const agents = await createBuiltinAgents(
      [],
      {
        athena: { model: TEST_DEFAULT_MODEL },
        "athena-junior": { model: TEST_DEFAULT_MODEL },
      },
      undefined,
      TEST_DEFAULT_MODEL,
      undefined,
      undefined,
      [],
      {},
      undefined,
      undefined,
      undefined,
      false,
      TEST_COUNCIL_CONFIG,
      false,
      false,
      { non_interactive_mode: "delegation" }
    )

    const agent = agents[`${ATHENA_JUNIOR_COUNCIL_MEMBER_KEY_PREFIX}alpha`]
    const tools = agent.tools as Record<string, boolean>
    const permission = agent.permission as Record<string, string>

    expect(tools.read).toBe(true)
    expect(tools.call_omo_agent).toBe(true)
    expect(tools.background_output).toBe(true)
    expect(tools.background_wait).toBe(true)
    expect(tools.background_cancel).toBe(true)
    expect(permission.read).toBe("allow")
    expect(permission.call_omo_agent).toBe("allow")
  })
})
