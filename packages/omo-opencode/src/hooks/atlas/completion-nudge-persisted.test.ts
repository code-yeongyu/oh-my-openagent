import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { randomUUID } from "node:crypto"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createBoulderState, readBoulderState, writeBoulderState } from "../../features/boulder-state"
import { _resetForTesting, registerAgentName } from "../../features/claude-code-session-state"
import { releaseAllPromptAsyncReservationsForTesting } from "../shared/prompt-async-gate"
import { handleAtlasSessionIdle } from "./idle-event"
import type { SessionState } from "./types"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"

const SESSION_ID = "ses_main"

describe("boulder completion nudge is sent once per work, across state loss (#4744)", () => {
  let directory = ""

  beforeEach(() => {
    directory = join(tmpdir(), `atlas-4744-${randomUUID()}`)
    mkdirSync(directory, { recursive: true })
    _resetForTesting()
    registerAgentName("atlas")
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
    _resetForTesting()
    releaseAllPromptAsyncReservationsForTesting()
  })

  function completedPlan(): string {
    const planPath = join(directory, "plan.md")
    writeFileSync(planPath, "## TODOs\n- [x] 1. Parse input\n")
    const boulder = createBoulderState(planPath, SESSION_ID, "atlas")
    writeBoulderState(directory, boulder)
    const workId = boulder.active_work_id
    if (!workId) throw new Error("Expected active_work_id")
    return workId
  }

  function harness() {
    const promptAsync = mock(async () => ({ data: {} }))
    const ctx = unsafeTestValue<PluginInput>({ directory, client: { session: { promptAsync } } })
    const sessions = new Map<string, SessionState>()
    const getState = (id: string): SessionState => {
      let state = sessions.get(id)
      if (!state) {
        state = { promptFailureCount: 0 }
        sessions.set(id, state)
      }
      return state
    }
    const idle = async () => {
      await handleAtlasSessionIdle({ ctx, sessionID: SESSION_ID, getState })
      releaseAllPromptAsyncReservationsForTesting()
    }
    return { promptAsync, sessions, idle }
  }

  it("#given the nudge was sent #when the session's in-memory state is pruned and the session idles again #then no second nudge is sent", async () => {
    //#given
    completedPlan()
    const { promptAsync, sessions, idle } = harness()
    await idle()

    //#when
    sessions.delete(SESSION_ID)
    await idle()

    //#then
    expect(promptAsync).toHaveBeenCalledTimes(1)
  })

  it("#given the nudge was sent #when the plugin restarts with empty memory and the session idles #then no second nudge is sent", async () => {
    //#given
    completedPlan()
    const before = harness()
    await before.idle()

    //#when
    const afterRestart = harness()
    await afterRestart.idle()

    //#then
    expect(before.promptAsync).toHaveBeenCalledTimes(1)
    expect(afterRestart.promptAsync).not.toHaveBeenCalled()
  })

  it("#given the nudge was sent #when the boulder state is read back #then the work records when it was nudged", async () => {
    //#given
    const workId = completedPlan()
    const { idle } = harness()

    //#when
    await idle()

    //#then
    expect(readBoulderState(directory)?.works?.[workId]?.completion_nudged_at).toBeString()
  })
})
