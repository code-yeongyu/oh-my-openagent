import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { TASK_CLEANUP_DELAY_MS } from "../../features/background-agent/constants"
import { handedBackSyncSessions } from "../../features/claude-code-session-state"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { executeSyncContinuation } from "./sync-continuation"
import type { SyncContinuationDeps } from "./sync-continuation-deps"
import { cancelSyncSessionDeletion, scheduleSyncSessionDeletion } from "./sync-session-cleanup"
import { executeSyncTask } from "./sync-task"
import type { SyncTaskDeps } from "./sync-task-deps"
import type { ExecutorContext } from "./executor-types"
import type { OpencodeClient, ToolContextWithMetadata } from "./types"

type RecordedTimer = {
  readonly delay: number
  readonly callback: () => void
  readonly handle: ReturnType<typeof setTimeout>
}

const SESSION_IDS = ["ses_cleanup_custom", "ses_cleanup_default", "ses_cleanup_resume", "ses_cleanup_prompt_fail"] as const
const parentContext = { sessionID: "parent-session", messageID: "parent-message" }
const toolContext: ToolContextWithMetadata = {
  ...parentContext,
  agent: "test-agent",
  abort: new AbortController().signal,
  metadata: () => {},
}

function createClient(promptAsync = mock(async () => ({}))) {
  const deleteSession = mock(async (_input: { path: { id: string } }) => ({}))
  const client = unsafeTestValue<OpencodeClient>({
    session: {
      delete: deleteSession,
      abort: async () => ({}),
      messages: async () => ({ data: [] }),
      promptAsync,
      status: async () => ({ data: {} }),
    },
  })
  return { client, deleteSession }
}

function createExecutorContext(client: OpencodeClient, taskCleanupDelayMs?: number): ExecutorContext {
  return unsafeTestValue<ExecutorContext>({
    client,
    directory: "/tmp",
    manager: {
      assertCanSpawn: async () => ({ rootSessionID: "parent-session", parentDepth: 0, childDepth: 1 }),
    },
    taskCleanupDelayMs,
  })
}

function createSyncTaskDeps(sessionID: string): SyncTaskDeps {
  return {
    createSyncSession: async () => ({ ok: true, sessionID, parentDirectory: "/tmp" }),
    sendSyncPrompt: async () => null,
    pollSyncSession: async () => null,
    fetchSyncResult: async () => ({ ok: true, textContent: "done" }),
  }
}

const continuationDeps: SyncContinuationDeps = {
  pollSyncSession: async () => null,
  fetchSyncResult: async () => ({ ok: true, textContent: "done" }),
}

describe("sync cleanup delay threading", () => {
  let recordedTimers: RecordedTimer[]
  let timerSpy: ReturnType<typeof spyOn<typeof globalThis, "setTimeout">>
  let clearTimerSpy: ReturnType<typeof spyOn<typeof globalThis, "clearTimeout">>

  const pendingTimers = (): RecordedTimer[] => recordedTimers.filter(
    (timer) => !clearTimerSpy.mock.calls.some(([handle]) => handle === timer.handle),
  )

  beforeEach(() => {
    recordedTimers = []
    const originalSetTimeout = globalThis.setTimeout
    timerSpy = spyOn(globalThis, "setTimeout").mockImplementation(unsafeTestValue<typeof setTimeout>(
      (callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
        const handle = originalSetTimeout(callback, delay, ...args)
        if (delay !== undefined && delay >= 60000) {
          recordedTimers.push({ delay, callback: () => callback(...args), handle })
        }
        return handle
      },
    ))
    clearTimerSpy = spyOn(globalThis, "clearTimeout")
  })

  afterEach(() => {
    for (const id of SESSION_IDS) cancelSyncSessionDeletion(id)
    for (const timer of recordedTimers) clearTimeout(timer.handle)
    clearTimerSpy.mockRestore()
    timerSpy.mockRestore()
    handedBackSyncSessions.clear()
  })

  test("#when a sync task completes with a configured delay #then its deletion uses that delay", async () => {
    const sessionID = SESSION_IDS[0]
    const { client, deleteSession } = createClient()

    await executeSyncTask(
      { description: "test task", prompt: "test prompt", run_in_background: false, load_skills: [] },
      toolContext, createExecutorContext(client, 120000), parentContext,
      "test-agent", undefined, undefined, undefined, undefined, createSyncTaskDeps(sessionID),
    )

    const deletionTimer = pendingTimers().slice(-1)[0]
    expect(deletionTimer?.delay).toBe(120000)
    deletionTimer?.callback()
    expect(deleteSession).toHaveBeenCalledWith({ path: { id: sessionID } })
  })

  test("#when a sync task completes without a configured delay #then its deletion uses the default", async () => {
    const sessionID = SESSION_IDS[1]
    const { client } = createClient()

    await executeSyncTask(
      { description: "test task", prompt: "test prompt", run_in_background: false, load_skills: [] },
      toolContext, createExecutorContext(client), parentContext,
      "test-agent", undefined, undefined, undefined, undefined, createSyncTaskDeps(sessionID),
    )

    expect(pendingTimers().slice(-1)[0]?.delay).toBe(TASK_CLEANUP_DELAY_MS)
  })

  test("#when a continuation completes #then it cancels and re-arms deletion with the configured delay", async () => {
    const sessionID = SESSION_IDS[2]
    const { client } = createClient()
    scheduleSyncSessionDeletion(client, sessionID)
    const earlierTimer = recordedTimers[0]

    await executeSyncContinuation(
      { task_id: sessionID, description: "test continuation", prompt: "continue", run_in_background: false, load_skills: [] },
      toolContext, createExecutorContext(client, 120000), parentContext, continuationDeps,
    )

    expect(clearTimerSpy).toHaveBeenCalledWith(earlierTimer?.handle)
    expect(pendingTimers().slice(-1)[0]?.delay).toBe(120000)
  })

  test("#when a continuation prompt fails #then deletion is re-armed with the configured delay", async () => {
    const sessionID = SESSION_IDS[3]
    const { client } = createClient(mock(async () => { throw new Error("Session not found") }))

    await executeSyncContinuation(
      { task_id: sessionID, description: "test continuation", prompt: "continue", run_in_background: false, load_skills: [] },
      toolContext, createExecutorContext(client, 120000), parentContext, continuationDeps,
    )

    expect(pendingTimers().slice(-1)[0]?.delay).toBe(120000)
  })
})
