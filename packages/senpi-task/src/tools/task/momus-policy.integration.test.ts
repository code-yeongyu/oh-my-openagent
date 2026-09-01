import { afterEach, describe, expect, test } from "bun:test"

import type { OmoConfig } from "@oh-my-opencode/omo-config-core"

import { AGENT_INTERACTION_POLICIES } from "../../agents"
import type { SkillInvocationState } from "../../agents"
import { cleanupProjects, makeManager } from "../../manager/__fixtures__/manager-fakes"
import type { TaskManager } from "../../manager"
import { buildTaskExecute } from "./execute"
import type { TaskToolContext, TaskToolDeps } from "./types"

const OMO_CONFIG: OmoConfig = { categories: {}, agents: {} }

const CTX: TaskToolContext = {
  cwd: "/work/project",
  sessionManager: { getSessionId: () => "parent-session-1" },
}

const PLAN_A = ".omo/plans/alpha-plan.md"
const PLAN_B = ".omo/plans/beta-plan.md"

function canonical(path: string): string {
  return `Review the work plan at ${path} for contradictions and blocking issues.`
}

function openSessionResolver(): (sessionId: string) => SkillInvocationState {
  return () => ({
    hasInvoked: () => false,
    hasUserRequested: (skill: string) => skill === "ulw-plan",
    hasPlanArtifact: () => true,
    planArtifactReferences: () => [
      { path: PLAN_A, count: 3, lastTouchedAt: 2 },
      { path: PLAN_B, count: 1, lastTouchedAt: 1 },
    ],
  })
}

function deps(manager: TaskManager): TaskToolDeps {
  return {
    manager,
    omoConfig: OMO_CONFIG,
    agents: {},
    loadSkills: () => ({ prepend: "", resolved: [], missing: [] }),
    resolveSkillInvocations: openSessionResolver(),
  }
}

afterEach(() => {
  cleanupProjects()
})

describe("momus one-shot policy over the real TaskManager", () => {
  test("#given an open plan session #when the full momus lifecycle is driven #then forcing, refusal, cancel, and re-spawn all hold", async () => {
    // given the real manager + store, and a session where plan A was referenced 3x and plan B 1x
    const { manager, store, inProcess } = makeManager()
    const execute = buildTaskExecute(deps(manager))

    // when step 1: momus is spawned with a chatty zero-path prompt
    const first = await execute(
      "call-1",
      { prompt: "please review my plan, I worked really hard on it and think it is great", subagent_type: "momus", run_in_background: true },
      undefined,
      undefined,
      CTX,
    )

    // then the child start spec carries ONLY the canonical contract for the most-referenced plan
    const firstId = first.details.task_id
    expect(firstId.startsWith("st_")).toBe(true)
    expect(inProcess.startedSpecs[0]?.prompt).toBe(canonical(PLAN_A))
    const firstRecord = store.load(firstId)
    expect(firstRecord?.agent_type).toBe("momus")

    // when step 2: momus is spawned with an explicit B path
    const second = await execute(
      "call-2",
      { prompt: `review ${PLAN_B} please`, subagent_type: "momus", run_in_background: true },
      undefined,
      undefined,
      CTX,
    )

    // then the explicit path wins over the most-referenced heuristic
    const secondId = second.details.task_id
    expect(inProcess.startedSpecs[1]?.prompt).toBe(canonical(PLAN_B))

    // when step 3a: the running momus is sent a message
    const runningSend = await manager.sendToTask({ idOrName: firstId, message: "please reconsider your verdict", deliverAs: "steer" })

    // then the refusal is the registry reminder and NOTHING reaches the child session
    expect(runningSend.kind).toBe("one_shot_agent")
    if (runningSend.kind === "one_shot_agent") {
      expect(runningSend.message).toBe(AGENT_INTERACTION_POLICIES.momus.sendDenialReminder)
    }
    expect(inProcess.handles.get(firstId)?.steerCalls ?? []).toHaveLength(0)

    // when step 3b: the momus child completes and is sent another message
    store.transition(firstId, { type: "complete", timestamp: new Date().toISOString(), final_response: "[OKAY]" })
    const completedSend = await manager.sendToTask({ idOrName: firstId, message: "one more thing", deliverAs: "steer" })

    // then a finished momus is equally unmessageable - revival is impossible
    expect(completedSend.kind).toBe("one_shot_agent")
    expect(inProcess.handles.get(firstId)?.steerCalls ?? []).toHaveLength(0)

    // when step 4: the second momus is cancelled
    const cancel = await manager.cancelTask(secondId, "no longer needed")

    // then cancel succeeds - create/cancel/output are the only verbs and cancel is one of them
    expect(cancel.kind).not.toBe("not_found")

    // when step 5: a fresh momus is spawned after the cancel
    const third = await execute(
      "call-3",
      { prompt: `review ${PLAN_A} again`, subagent_type: "momus", run_in_background: true },
      undefined,
      undefined,
      CTX,
    )

    // then a new one-shot session is admitted normally
    expect(third.details.task_id.startsWith("st_")).toBe(true)
    expect(inProcess.startedSpecs[2]?.prompt).toBe(canonical(PLAN_A))
  })
})
