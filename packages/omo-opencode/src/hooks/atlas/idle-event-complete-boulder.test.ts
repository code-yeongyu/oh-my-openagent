import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { clearBoulderState, readBoulderState, writeBoulderState } from "../../features/boulder-state"
import { _resetForTesting, registerAgentName } from "../../features/claude-code-session-state"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"

const { createAtlasHook } = await import("./index")

function createHookWithPromptSpy(input: {
  testDirectory: string
  sessionID: string
}): {
  hook: ReturnType<typeof createAtlasHook>
  promptAsyncCallCount: () => number
} {
  let promptAsyncCalls = 0
  const hook = createAtlasHook(unsafeTestValue<Parameters<typeof createAtlasHook>[0]>({
    directory: input.testDirectory,
    client: {
      session: {
        get: async () => ({ data: { id: input.sessionID } }),
        messages: async () => ({ data: [] }),
        status: async () => ({ data: {} }),
        prompt: async () => ({ data: {} }),
        promptAsync: async () => {
          promptAsyncCalls += 1
          return { data: {} }
        },
      },
    },
  }))
  return { hook, promptAsyncCallCount: () => promptAsyncCalls }
}

describe("atlas hook idle-event complete boulder", () => {
  let testDirectory = ""

  beforeEach(() => {
    testDirectory = join(tmpdir(), `atlas-idle-complete-${randomUUID()}`)
    if (!existsSync(testDirectory)) {
      mkdirSync(testDirectory, { recursive: true })
    }
    clearBoulderState(testDirectory)
    _resetForTesting()
    registerAgentName("atlas")
  })

  afterEach(() => {
    clearBoulderState(testDirectory)
    if (existsSync(testDirectory)) {
      rmSync(testDirectory, { recursive: true, force: true })
    }
    _resetForTesting()
  })

  it("marks work completed with ended_at and elapsed_ms when progress is complete", async () => {
    // given
    const sessionID = "ses_complete"
    const planPath = join(testDirectory, "complete-plan.md")
    writeFileSync(planPath, "# Plan\n\n## TODOs\n- [x] 1. Done\n", "utf-8")
    writeBoulderState(testDirectory, {
      schema_version: 2,
      active_work_id: "work-complete",
      active_plan: planPath,
      started_at: "2026-01-02T10:00:00.000Z",
      session_ids: [sessionID],
      plan_name: "complete-plan",
      works: {
        "work-complete": {
          work_id: "work-complete",
          active_plan: planPath,
          plan_name: "complete-plan",
          started_at: "2026-01-02T10:00:00.000Z",
          session_ids: [sessionID],
          status: "active",
        },
      },
    })

    const hook = createAtlasHook(unsafeTestValue<Parameters<typeof createAtlasHook>[0]>({
      directory: testDirectory,
      client: {
        session: {
          get: async () => ({ data: { id: sessionID } }),
          messages: async () => ({ data: [] }),
          prompt: async () => ({ data: {} }),
          promptAsync: async () => ({ data: {} }),
        },
      },
    }))

    // when
    await hook.handler({
      event: {
        type: "session.idle",
        properties: { sessionID },
      },
    })

    // then
    const work = readBoulderState(testDirectory)?.works?.["work-complete"]
    expect(work?.status).toBe("completed")
    expect(work?.ended_at).toBeString()
    expect((work?.elapsed_ms ?? 0) > 0).toBe(true)
  })

  it("does not re-enter the continuation loop when a completed work goes idle with its plan file gone", async () => {
    // given: work already completed (terminal) and the plan file deleted afterwards,
    // so getPlanProgress reports { total: 0, completed: 0, isComplete: false }
    const sessionID = "ses_loop"
    writeBoulderState(testDirectory, {
      schema_version: 2,
      active_work_id: "work-loop",
      active_plan: join(testDirectory, "vanished-plan.md"),
      started_at: "2026-01-02T10:00:00.000Z",
      session_ids: [sessionID],
      plan_name: "vanished-plan",
      status: "completed",
      works: {
        "work-loop": {
          work_id: "work-loop",
          active_plan: join(testDirectory, "vanished-plan.md"),
          plan_name: "vanished-plan",
          started_at: "2026-01-02T10:00:00.000Z",
          session_ids: [sessionID],
          status: "completed",
        },
      },
    })
    const { hook, promptAsyncCallCount } = createHookWithPromptSpy({ testDirectory, sessionID })

    // when: the session goes idle after the todo list is exhausted
    await hook.handler({
      event: {
        type: "session.idle",
        properties: { sessionID },
      },
    })

    // then: Atlas terminates cleanly - no continuation prompt is dispatched
    expect(promptAsyncCallCount()).toBe(0)
  })

  it("fires the terminal completion transition exactly once across repeated idles", async () => {
    // given: fully checked plan so progress.isComplete is true
    const sessionID = "ses_once"
    const planPath = join(testDirectory, "once-plan.md")
    writeFileSync(planPath, "# Plan\n\n## TODOs\n- [x] 1. Done\n- [x] 2. Also done\n", "utf-8")
    writeBoulderState(testDirectory, {
      schema_version: 2,
      active_work_id: "work-once",
      active_plan: planPath,
      started_at: "2026-01-02T10:00:00.000Z",
      session_ids: [sessionID],
      plan_name: "once-plan",
      works: {
        "work-once": {
          work_id: "work-once",
          active_plan: planPath,
          plan_name: "once-plan",
          started_at: "2026-01-02T10:00:00.000Z",
          session_ids: [sessionID],
          status: "active",
        },
      },
    })
    const { hook, promptAsyncCallCount } = createHookWithPromptSpy({ testDirectory, sessionID })

    // when: two consecutive idles fire after todos are exhausted
    await hook.handler({
      event: {
        type: "session.idle",
        properties: { sessionID },
      },
    })
    await hook.handler({
      event: {
        type: "session.idle",
        properties: { sessionID },
      },
    })

    // then: only the single completion nudge was dispatched, and the work is terminal
    expect(promptAsyncCallCount()).toBe(1)
    expect(readBoulderState(testDirectory)?.works?.["work-once"]?.status).toBe("completed")
  })
})
