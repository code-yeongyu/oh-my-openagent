import { afterEach, expect, test } from "bun:test"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { TASK_CLEANUP_DELAY_MS } from "../../features/background-agent/constants"
import { handedBackSyncSessions } from "../../features/claude-code-session-state"
import type { ExecutorContext, ParentContext } from "./executor-types"
import { cancelSyncSessionDeletion } from "./sync-session-cleanup"
import { executeSyncTask } from "./sync-task"
import type { SyncTaskDeps } from "./sync-task-deps"
import type { DelegateTaskArgs, ToolContextWithMetadata } from "./types"

const CHILD_SESSION_ID = "ses_abort_settlement_child"
const PARENT_SESSION_ID = "ses_abort_settlement_parent"

afterEach(() => {
  cancelSyncSessionDeletion(CHILD_SESSION_ID)
  handedBackSyncSessions.delete(CHILD_SESSION_ID)
})

function createManager(onRelease: () => void): ExecutorContext["manager"] {
  return unsafeTestValue<ExecutorContext["manager"]>({
    acquireSyncSubagentConcurrency: async () => {},
    releaseSyncSubagentConcurrency: onRelease,
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
}

function executeForegroundProbe(input: {
  readonly client: ExecutorContext["client"]
  readonly manager: ExecutorContext["manager"]
  readonly description: string
  readonly messageID: string
}): Promise<string> {
  const executorContext = unsafeTestValue<ExecutorContext>({
    client: input.client,
    directory: "/tmp",
    manager: input.manager,
  })
  const toolContext = unsafeTestValue<ToolContextWithMetadata>({
    sessionID: PARENT_SESSION_ID,
    messageID: input.messageID,
    agent: "Atlas - Plan Executor",
    abort: new AbortController().signal,
  })
  const parentContext: ParentContext = {
    sessionID: toolContext.sessionID,
    messageID: toolContext.messageID,
    agent: toolContext.agent,
  }
  const args: DelegateTaskArgs = {
    description: input.description,
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

  return executeSyncTask(
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
}

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
  let markerPresentWhenAbortStarted = false
  let concurrencyReleaseCount = 0
  const manager = createManager(() => {
    concurrencyReleaseCount += 1
  })
  const client = unsafeTestValue<ExecutorContext["client"]>({
    session: {
      abort: async () => {
        markerPresentWhenAbortStarted = handedBackSyncSessions.has(CHILD_SESSION_ID)
        markAbortStarted?.()
        await abortReleased
        return { data: true }
      },
    },
  })

  //#when
  let handbackSettled = false
  const execution = executeForegroundProbe({
    client,
    manager,
    description: "abort settlement probe",
    messageID: "msg_abort_settlement_parent",
  })
  const executionSettlement = execution.then(
    () => {
      handbackSettled = true
    },
    () => undefined,
  )
  try {
    await abortStarted
    expect(markerPresentWhenAbortStarted).toBe(true)
    await Promise.resolve()

    //#then
    expect(handbackSettled).toBe(false)
    expect(concurrencyReleaseCount).toBe(0)
    releaseAbort?.()
    expect(await execution).toContain("done")
    expect(concurrencyReleaseCount).toBe(1)
  } finally {
    releaseAbort?.()
    await executionSettlement
  }
})

test("#given a completed foreground child whose abort hangs #when abort cleanup times out #then handback preserves the result and releases cleanup ownership", async () => {
  //#given
  const originalSetTimeout = globalThis.setTimeout
  const timerHandles: Array<ReturnType<typeof setTimeout>> = []
  const scheduledDelays: number[] = []
  const lifecycle: string[] = []
  const unhandledRejections: unknown[] = []
  let abortTimeoutCallback: (() => void) | undefined
  let markAbortStarted: (() => void) | undefined
  let resolveAbort: (() => void) | undefined
  let rejectAbort: ((reason: unknown) => void) | undefined
  let markerPresentWhenAbortStarted = false
  let concurrencyReleaseCount = 0
  let deletionCount = 0
  const abortStarted = new Promise<void>((resolve) => {
    markAbortStarted = resolve
  })
  const abortPending = new Promise<unknown>((resolve, reject) => {
    resolveAbort = () => resolve({ data: true })
    rejectAbort = reject
  })
  const onUnhandledRejection = (reason: unknown): void => {
    unhandledRejections.push(reason)
  }
  const manager = createManager(() => {
    lifecycle.push("concurrency-released")
    concurrencyReleaseCount += 1
  })
  const client = unsafeTestValue<ExecutorContext["client"]>({
    session: {
      abort: async () => {
        markerPresentWhenAbortStarted = handedBackSyncSessions.has(CHILD_SESSION_ID)
        lifecycle.push("abort-started")
        markAbortStarted?.()
        return await abortPending
      },
      delete: async () => {
        deletionCount += 1
        return { data: true }
      },
    },
  })
  let executionSettlement: Promise<void> | undefined
  let executionDeadline: Promise<never> | undefined
  let executionDeadlineHandle: ReturnType<typeof setTimeout> | undefined

  try {
    executionDeadline = new Promise<never>((_resolve, reject) => {
      executionDeadlineHandle = originalSetTimeout(() => reject(new Error("Execution settlement timed out")), 2_000)
      executionDeadlineHandle.unref()
    })
    process.on("unhandledRejection", onUnhandledRejection)
    globalThis.setTimeout = unsafeTestValue<typeof setTimeout>((callback: () => void, delay?: number) => {
      const effectiveDelay = delay ?? 0
      scheduledDelays.push(effectiveDelay)
      if (effectiveDelay === 10_000) {
        abortTimeoutCallback = () => {
          lifecycle.push("abort-timeout")
          callback()
        }
        const handle = originalSetTimeout(() => {}, 60_000)
        handle.unref()
        timerHandles.push(handle)
        return handle
      }

      lifecycle.push("deletion-scheduled")
      const handle = originalSetTimeout(callback, effectiveDelay)
      timerHandles.push(handle)
      return handle
    })
    let handbackSettled = false
    const execution = executeForegroundProbe({
      client,
      manager,
      description: "abort timeout probe",
      messageID: "msg_abort_timeout_parent",
    })
    executionSettlement = execution.then(
      () => {
        handbackSettled = true
      },
      () => undefined,
    )

    //#when
    await Promise.race([abortStarted, executionDeadline])
    expect(markerPresentWhenAbortStarted).toBe(true)
    await Promise.resolve()

    //#then
    expect(abortTimeoutCallback).toBeDefined()
    expect(handbackSettled).toBe(false)
    expect(scheduledDelays).toEqual([10_000])
    expect(concurrencyReleaseCount).toBe(0)
    expect(deletionCount).toBe(0)

    abortTimeoutCallback?.()
    expect(await execution).toContain("done")
    expect(scheduledDelays).toEqual([10_000, TASK_CLEANUP_DELAY_MS])
    expect(lifecycle).toEqual([
      "abort-started",
      "abort-timeout",
      "deletion-scheduled",
      "concurrency-released",
    ])
    expect(concurrencyReleaseCount).toBe(1)
    expect(deletionCount).toBe(0)

    rejectAbort?.(new Error("late abort rejection"))
    await new Promise<void>((resolve) => originalSetTimeout(resolve, 0))
    expect(unhandledRejections).toEqual([])
  } finally {
    process.off("unhandledRejection", onUnhandledRejection)
    globalThis.setTimeout = originalSetTimeout
    cancelSyncSessionDeletion(CHILD_SESSION_ID)
    for (const handle of timerHandles) clearTimeout(handle)
    resolveAbort?.()
    try {
      await Promise.race([executionSettlement, executionDeadline])
    } finally {
      if (executionDeadlineHandle) clearTimeout(executionDeadlineHandle)
    }
  }
})
