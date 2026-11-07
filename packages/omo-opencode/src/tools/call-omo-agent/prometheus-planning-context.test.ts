import { beforeEach, describe, expect, mock, test } from "bun:test"
import { createCallOmoAgent } from "./tools"
import { clearCallableAgentsCache } from "./agent-resolver"
import { PLANNING_CONTEXT_OPEN } from "../../hooks/prometheus-md-only/constants"

type OpencodeClient = import("@opencode-ai/plugin").PluginInput["client"]
type PluginInput = { client: OpencodeClient; directory: string }

const DEFAULT_AGENTS = [
  { name: "explore", mode: "subagent" },
  { name: "librarian", mode: "subagent" },
]

function createMockCtx(agents: Array<{ name: string; mode?: string }>): PluginInput {
  return {
    client: {
      app: {
        agents: mock(() => Promise.resolve({ data: agents })),
      },
    } as unknown as OpencodeClient,
    directory: "/test",
  }
}

function createManagerWithLaunch() {
  const launch = mock((_input: { prompt?: string }) =>
    Promise.resolve({
      id: "task-child",
      sessionId: "ses-child",
      description: "Test task",
      agent: "explore",
      status: "pending",
    }))
  return {
    launch,
    getTask: mock(() => undefined),
  }
}

describe("call-omo-agent prometheus planning context injection (#6291)", () => {
  beforeEach(() => {
    clearCallableAgentsCache()
  })

  describe("#given a prometheus parent delegating via call_omo_agent", () => {
    test("#when dispatched in background mode #then child launch prompt contains the planning-context marker", async () => {
      // given
      const manager = createManagerWithLaunch()
      const toolDef = createCallOmoAgent(createMockCtx(DEFAULT_AGENTS), manager)
      const executeFunc = toolDef.execute as Function

      // when
      await executeFunc(
        {
          description: "Research task",
          prompt: "Find auth patterns",
          subagent_type: "explore",
          run_in_background: true,
        },
        { sessionID: "test", messageID: "msg", agent: "prometheus", abort: new AbortController().signal },
      )

      // then - the prompt actually handed to the child must carry the warning
      const [launchArgs] = manager.launch.mock.calls[0]
      expect(launchArgs.prompt).toContain(PLANNING_CONTEXT_OPEN)
    })

    test("#when prompt already contains the marker #then it is not doubled", async () => {
      // given
      const manager = createManagerWithLaunch()
      const toolDef = createCallOmoAgent(createMockCtx(DEFAULT_AGENTS), manager)
      const executeFunc = toolDef.execute as Function
      const guarded = `Find auth patterns\n${PLANNING_CONTEXT_OPEN}\nalready guarded`

      // when
      await executeFunc(
        {
          description: "Research task",
          prompt: guarded,
          subagent_type: "explore",
          run_in_background: true,
        },
        { sessionID: "test", messageID: "msg", agent: "prometheus", abort: new AbortController().signal },
      )

      // then
      const [launchArgs] = manager.launch.mock.calls[0]
      expect(launchArgs.prompt).toBe(guarded)
    })
  })

  describe("#given a non-prometheus parent", () => {
    test("#when dispatched #then prompt is left untouched", async () => {
      // given
      const manager = createManagerWithLaunch()
      const toolDef = createCallOmoAgent(createMockCtx(DEFAULT_AGENTS), manager)
      const executeFunc = toolDef.execute as Function

      // when
      await executeFunc(
        {
          description: "Research task",
          prompt: "Find auth patterns",
          subagent_type: "explore",
          run_in_background: true,
        },
        { sessionID: "test", messageID: "msg", agent: "sisyphus", abort: new AbortController().signal },
      )

      // then
      const [launchArgs] = manager.launch.mock.calls[0]
      expect(launchArgs.prompt).not.toContain(PLANNING_CONTEXT_OPEN)
    })
  })

  describe("#given injection disabled via disabled_hooks parity option", () => {
    test("#when dispatched by prometheus #then prompt is left untouched", async () => {
      // given
      const manager = createManagerWithLaunch()
      const toolDef = createCallOmoAgent(createMockCtx(DEFAULT_AGENTS), manager, [], undefined, undefined, undefined, true)
      const executeFunc = toolDef.execute as Function

      // when
      await executeFunc(
        {
          description: "Research task",
          prompt: "Find auth patterns",
          subagent_type: "explore",
          run_in_background: true,
        },
        { sessionID: "test", messageID: "msg", agent: "prometheus", abort: new AbortController().signal },
      )

      // then
      const [launchArgs] = manager.launch.mock.calls[0]
      expect(launchArgs.prompt).not.toContain(PLANNING_CONTEXT_OPEN)
    })
  })
})
