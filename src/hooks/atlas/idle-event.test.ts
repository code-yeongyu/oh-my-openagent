import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createBoulderState, readBoulderState, writeBoulderState } from "../../features/boulder-state"
import { _resetForTesting, registerAgentName } from "../../features/claude-code-session-state"
import {
  releaseAllPromptAsyncReservationsForTesting,
  releasePromptAsyncReservation,
} from "../shared/prompt-async-gate"
import { handleAtlasSessionIdle } from "./idle-event"
import type { SessionState } from "./types"
import { unsafeTestValue } from "../../../test-support/unsafe-test-value"

describe("handleAtlasSessionIdle completion nudge", () => {
  const SESSION_ID = "session-main-1"

  let testDirectory = ""

  beforeEach(() => {
    testDirectory = join(tmpdir(), `atlas-idle-complete-${randomUUID()}`)
    if (!existsSync(testDirectory)) {
      mkdirSync(testDirectory, { recursive: true })
    }
    _resetForTesting()
    registerAgentName("atlas")
  })

  afterEach(() => {
    if (existsSync(testDirectory)) {
      rmSync(testDirectory, { recursive: true, force: true })
    }
    _resetForTesting()
    releaseAllPromptAsyncReservationsForTesting()
  })

  it("injects BOULDER COMPLETE prompt once per work with substituted elapsed and task breakdown", async () => {
    // given
    const planPath = join(testDirectory, "plan.md")
    writeFileSync(planPath, "## TODOs\n- [x] 1. Parse input\n- [x] 2. Save output\n")

    const boulder = createBoulderState(planPath, SESSION_ID, "atlas")
    const workId = boulder.active_work_id
    if (!workId) {
      throw new Error("Expected active_work_id")
    }

    const work = boulder.works?.[workId]
    if (!work) {
      throw new Error("Expected active work")
    }

    work.elapsed_ms = 65_000
    boulder.elapsed_ms = 65_000
    work.task_sessions = {
      "todo:2": {
        task_key: "todo:2",
        task_label: "2",
        task_title: "Save output",
        session_id: "sub-2",
        elapsed_ms: 4_000,
        updated_at: new Date().toISOString(),
      },
      "todo:1": {
        task_key: "todo:1",
        task_label: "1",
        task_title: "Parse input",
        session_id: "sub-1",
        elapsed_ms: 61_000,
        updated_at: new Date().toISOString(),
      },
    }
    boulder.task_sessions = work.task_sessions

    writeBoulderState(testDirectory, boulder)

    const promptRequests: Array<{
      body?: {
        noReply?: boolean
        parts?: Array<{
          text?: string
          synthetic?: boolean
          metadata?: Record<string, unknown>
        }>
      }
    }> = []
    const promptAsyncMock = mock(async (request: {
      body?: {
        noReply?: boolean
        parts?: Array<{
          text?: string
          synthetic?: boolean
          metadata?: Record<string, unknown>
        }>
      }
    }) => {
      promptRequests.push(request)
      return { data: {} }
    })

    const ctx = unsafeTestValue<PluginInput>({
      directory: testDirectory,
      client: {
        session: {
          promptAsync: promptAsyncMock,
        },
      },
    })

    const sessionStateById = new Map<string, SessionState>()
    const getState = (sessionId: string): SessionState => {
      let state = sessionStateById.get(sessionId)
      if (!state) {
        state = { promptFailureCount: 0 }
        sessionStateById.set(sessionId, state)
      }
      return state
    }

    // when
    await handleAtlasSessionIdle({
      ctx,
      sessionID: SESSION_ID,
      getState,
    })

    await handleAtlasSessionIdle({
      ctx,
      sessionID: SESSION_ID,
      getState,
    })

    // then
    expect(promptAsyncMock).toHaveBeenCalledTimes(1)

    const promptText = promptRequests[0]?.body?.parts?.[0]?.text ?? ""
    expect(promptText).toContain("BOULDER COMPLETE")
    expect(promptText).toContain("Total elapsed: 1m 5s")
    expect(promptText).toContain("- 1 Parse input: 1m 1s")
    expect(promptText).toContain("- 2 Save output: 4s")
    expect(promptText).not.toContain("{ELAPSED_HUMAN}")
    expect(promptRequests[0]?.body?.noReply).toBeUndefined()
    expect(promptRequests[0]?.body?.parts?.[0]?.synthetic).toBe(true)
    expect(promptRequests[0]?.body?.parts?.[0]?.metadata?.compaction_continue).toBe(true)

    const persistedState = getState(SESSION_ID)
    expect(persistedState.boulderCompletionNudgedAt?.[workId]).toBeNumber()
    expect(readBoulderState(testDirectory)?.works?.[workId]?.status).toBe("completed")
  })

  it("#given completion nudge promptAsync may have been accepted before EOF #when idle repeats after the gate hold #then it does not send a duplicate completion nudge", async () => {
    // given
    const planPath = join(testDirectory, "plan.md")
    writeFileSync(planPath, "## TODOs\n- [x] 1. Parse input\n")

    const boulder = createBoulderState(planPath, SESSION_ID, "atlas")
    const workId = boulder.active_work_id
    if (!workId) {
      throw new Error("Expected active_work_id")
    }

    const work = boulder.works?.[workId]
    if (!work) {
      throw new Error("Expected active work")
    }
    work.elapsed_ms = 1_000
    boulder.elapsed_ms = 1_000
    writeBoulderState(testDirectory, boulder)

    const promptAsyncMock = mock(async () => {
      throw new Error("JSON Parse error: Unexpected EOF")
    })
    const ctx = unsafeTestValue<PluginInput>({
      directory: testDirectory,
      client: {
        session: {
          promptAsync: promptAsyncMock,
        },
      },
    })
    const sessionStateById = new Map<string, SessionState>()
    const getState = (sessionId: string): SessionState => {
      let state = sessionStateById.get(sessionId)
      if (!state) {
        state = { promptFailureCount: 0 }
        sessionStateById.set(sessionId, state)
      }
      return state
    }

    // when
    await handleAtlasSessionIdle({
      ctx,
      sessionID: SESSION_ID,
      getState,
    })
    const released = releasePromptAsyncReservation(SESSION_ID, "test:simulate-expired-hold", {
      reservedBy: "atlas",
    })
    await handleAtlasSessionIdle({
      ctx,
      sessionID: SESSION_ID,
      getState,
    })

    // then
    expect(released).toBe(true)
    expect(promptAsyncMock).toHaveBeenCalledTimes(1)
    expect(getState(SESSION_ID).boulderCompletionNudgedAt?.[workId]).toBeNumber()
  })

  it("does not send a completion nudge after continuation was explicitly stopped", async () => {
    // given
    const planPath = join(testDirectory, "plan.md")
    writeFileSync(planPath, "## TODOs\n- [x] 1. Parse input\n")

    const boulder = createBoulderState(planPath, SESSION_ID, "atlas")
    const workId = boulder.active_work_id
    if (!workId) {
      throw new Error("Expected active_work_id")
    }
    writeBoulderState(testDirectory, boulder)

    const promptAsyncMock = mock(async () => ({ data: {} }))
    const ctx = unsafeTestValue<PluginInput>({
      directory: testDirectory,
      client: {
        session: {
          promptAsync: promptAsyncMock,
        },
      },
    })
    const retryTimer = setTimeout(() => {}, 60_000)
    const sessionStateById = new Map<string, SessionState>([
      [SESSION_ID, { promptFailureCount: 0, pendingRetryTimer: retryTimer }],
    ])
    const getState = (sessionId: string): SessionState => {
      let state = sessionStateById.get(sessionId)
      if (!state) {
        state = { promptFailureCount: 0 }
        sessionStateById.set(sessionId, state)
      }
      return state
    }

    // when
    await handleAtlasSessionIdle({
      ctx,
      sessionID: SESSION_ID,
      getState,
      options: {
        isContinuationStopped: (sessionId) => sessionId === SESSION_ID,
      },
    })

    // then
    expect(promptAsyncMock).not.toHaveBeenCalled()
    expect(getState(SESSION_ID).pendingRetryTimer).toBeUndefined()
    expect(getState(SESSION_ID).boulderCompletionNudgedAt?.[workId]).toBeUndefined()
    expect(readBoulderState(testDirectory)?.works?.[workId]?.status).toBe("completed")
  })
})
