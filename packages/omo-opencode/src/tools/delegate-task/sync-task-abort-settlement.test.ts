import { afterEach, expect, test } from "bun:test"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { handedBackSyncSessions } from "../../features/claude-code-session-state"
import type { ExecutorContext, ParentContext } from "./executor-types"
import { executeSyncTask } from "./sync-task"
import type { SyncTaskDeps } from "./sync-task-deps"
import type { DelegateTaskArgs, ToolContextWithMetadata } from "./types"

const CHILD_SESSION_ID = "ses_abort_settlement_child"
const PARENT_SESSION_ID = "ses_abort_settlement_parent"

afterEach(() => {
  handedBackSyncSessions.delete(CHILD_SESSION_ID)
})

test("#given a completed foreground child #when handback starts #then abort settles before handback and concurrency release", async () => {
  //#given
  let markAbortStarted: (() => void) | undefined
  let releaseAbort: (() => void) | undefined
  const abortStarted = new Promise<void>((resolve) => {
    markAbortStarted = resolve
  })
  const abortReleased = new Promise<void>((resolve) => {
    releaseAbort = resolve
  })
  let concurrencyReleaseCount = 0
  const manager = unsafeTestValue<ExecutorContext["manager"]>({
    acquireSyncSubagentConcurrency: async () => {},
    releaseSyncSubagentConcurrency: () => {
      concurrencyReleaseCount += 1
    },
    reserveSubagentSpawn: async () => ({
      spawnContext: {
        rootSessionID: PARENT_SESSION_ID,
        parentDepth: 0,
        childDepth: 1,
      },
      commit: () => {},
      rollback: () => {},
    }),
  })
  const client = unsafeTestValue<ExecutorContext["client"]>({
    session: {
      abort: async () => {
        expect(handedBackSyncSessions.has(CHILD_SESSION_ID)).toBe(true)
        markAbortStarted?.()
        await abortReleased
        return { data: true }
      },
    },
  })
  const executorContext = unsafeTestValue<ExecutorContext>({
    client,
    directory: "/tmp",
    manager,
  })
  const toolContext = unsafeTestValue<ToolContextWithMetadata>({
    sessionID: PARENT_SESSION_ID,
    messageID: "msg_abort_settlement_parent",
    agent: "Atlas - Plan Executor",
    abort: new AbortController().signal,
  })
  const parentContext: ParentContext = {
    sessionID: toolContext.sessionID,
    messageID: toolContext.messageID,
    agent: toolContext.agent,
  }
  const args: DelegateTaskArgs = {
    description: "abort settlement probe",
    prompt: "return done",
    subagent_type: "explore",
    run_in_background: false,
    load_skills: [],
  }
  const deps = unsafeTestValue<SyncTaskDeps>({
    createSyncSession: async () => ({
      ok: true,
      sessionID: CHILD_SESSION_ID,
      parentDirectory: "/tmp",
    }),
    sendSyncPrompt: async () => null,
    pollSyncSession: async () => null,
    fetchSyncResult: async () => ({ ok: true, textContent: "done" }),
  })

  //#when
  const execution = executeSyncTask(
    args,
    toolContext,
    executorContext,
    parentContext,
    "explore",
    undefined,
    undefined,
    undefined,
    undefined,
    deps,
  )
  await abortStarted
  let handbackSettled = false
  void execution.then(() => {
    handbackSettled = true
  })
  await Promise.resolve()

  //#then
  expect(handbackSettled).toBe(false)
  expect(concurrencyReleaseCount).toBe(0)
  releaseAbort?.()
  expect(await execution).toContain("done")
  expect(concurrencyReleaseCount).toBe(1)
})
