import { describe, expect, test } from "bun:test"
import { PLANNING_CONTEXT_OPEN } from "../../hooks/prometheus-md-only/constants"
import type { DelegateTaskArgs } from "./types"

const SYSTEM_DEFAULT_MODEL = "anthropic/claude-sonnet-4-6"

type CapturedLaunchInput = {
  readonly prompt?: string
}

function createMockClient() {
  return {
    app: {
      agents: async () => ({
        data: [
          { name: "explore", mode: "subagent", model: { providerID: "anthropic", modelID: "claude-haiku-4-5" } },
        ],
      }),
    },
    config: { get: async () => ({ data: { model: SYSTEM_DEFAULT_MODEL } }) },
    session: {
      create: async () => ({ data: { id: "ses_child" } }),
      prompt: async () => ({ data: {} }),
      promptAsync: async () => ({ data: {} }),
      messages: async () => ({ data: [] }),
    },
  }
}

async function runDelegateTask(options: {
  parentAgent: string
  prompt: string
  planningWarningInjectionDisabled?: boolean
}): Promise<CapturedLaunchInput> {
  const { createDelegateTask } = await import("./tools")
  let launchInput: CapturedLaunchInput = {}
  const mockManager = {
    launch: async (input: CapturedLaunchInput) => {
      launchInput = input
      return {
        id: "task-child",
        sessionId: "ses_child",
        description: "Child task",
        agent: "explore",
        status: "running",
      }
    },
  }
  const tool = createDelegateTask({
    manager: mockManager,
    client: createMockClient(),
    planningWarningInjectionDisabled: options.planningWarningInjectionDisabled,
  })
  await tool.execute(
    {
      description: "Research codebase",
      prompt: options.prompt,
      subagent_type: "explore",
      run_in_background: true,
      load_skills: [],
    } satisfies DelegateTaskArgs & { load_skills: string[] },
    {
      sessionID: "parent-session",
      messageID: "parent-message",
      agent: options.parentAgent,
      abort: new AbortController().signal,
    },
  )
  return launchInput
}

describe("delegate-task prometheus planning context injection (#6291)", () => {
  describe("#given a prometheus parent delegating via task", () => {
    test("#when dispatched #then child launch prompt contains the planning-context marker", async () => {
      // when
      const launchInput = await runDelegateTask({ parentAgent: "prometheus", prompt: "Find auth patterns" })

      // then - the prompt actually handed to the child must carry the warning
      expect(launchInput.prompt).toContain(PLANNING_CONTEXT_OPEN)
    }, { timeout: 10000 })

    test("#when prompt already contains the marker #then it is not doubled", async () => {
      // given
      const guarded = `Find auth patterns\n${PLANNING_CONTEXT_OPEN}\nalready guarded`

      // when
      const launchInput = await runDelegateTask({ parentAgent: "prometheus", prompt: guarded })

      // then
      expect(launchInput.prompt).toBe(guarded)
    }, { timeout: 10000 })
  })

  describe("#given a non-prometheus parent", () => {
    test("#when dispatched #then prompt is left untouched", async () => {
      // when
      const launchInput = await runDelegateTask({ parentAgent: "sisyphus", prompt: "Find auth patterns" })

      // then
      expect(launchInput.prompt).not.toContain(PLANNING_CONTEXT_OPEN)
    }, { timeout: 10000 })
  })

  describe("#given injection disabled via disabled_hooks parity option", () => {
    test("#when dispatched by prometheus #then prompt is left untouched", async () => {
      // when
      const launchInput = await runDelegateTask({
        parentAgent: "prometheus",
        prompt: "Find auth patterns",
        planningWarningInjectionDisabled: true,
      })

      // then
      expect(launchInput.prompt).not.toContain(PLANNING_CONTEXT_OPEN)
    }, { timeout: 10000 })
  })
})
