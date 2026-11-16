import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { TASK_CLEANUP_DELAY_MS } from "../../features/background-agent/constants"
import { handedBackSyncSessions } from "../../features/claude-code-session-state"
import { cancelSyncSessionDeletion, scheduleSyncSessionDeletion } from "./sync-session-cleanup"
import type { OpencodeClient } from "./types"

type RecordedTimer = {
  handle: ReturnType<typeof setTimeout>
  delay: number
  callback: () => void
}

type FakeTimers = {
  timers: RecordedTimer[]
  clearedHandles: Array<ReturnType<typeof setTimeout>>
  restore: () => void
}

function installFakeTimers(): FakeTimers {
  const originalSetTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout
  const timers: RecordedTimer[] = []
  const clearedHandles: Array<ReturnType<typeof setTimeout>> = []

  globalThis.setTimeout = ((
    handler: Parameters<typeof setTimeout>[0],
    delay?: number,
    ..._args: unknown[]
  ): ReturnType<typeof setTimeout> => {
    if (typeof handler !== "function") {
      throw new Error("Expected function timeout handler")
    }

    //#given - a real, immediately-cleared handle so the production timer.unref() call works
    const handle = originalSetTimeout(() => {}, 0)
    originalClearTimeout(handle)
    timers.push({ handle, delay: delay ?? 0, callback: handler as () => void })
    return handle
  }) as typeof setTimeout

  globalThis.clearTimeout = ((timer?: ReturnType<typeof setTimeout>): void => {
    if (timer !== undefined) clearedHandles.push(timer)
  }) as typeof clearTimeout

  return {
    timers,
    clearedHandles,
    restore() {
      globalThis.setTimeout = originalSetTimeout
      globalThis.clearTimeout = originalClearTimeout
    },
  }
}

function createClient(): { client: OpencodeClient; deleteMock: ReturnType<typeof mock> } {
  const deleteMock = mock(async (_input: { path: { id: string } }) => ({}))
  const client = { session: { delete: deleteMock } } as unknown as OpencodeClient
  return { client, deleteMock }
}

const SESSION_IDS = ["ses_sscd_a", "ses_sscd_b", "ses_sscd_c", "ses_sscd_d"] as const

describe("sync-session-cleanup", () => {
  let fakeTimers: FakeTimers

  beforeEach(() => {
    //#given - fake timers so scheduling records the delay without leaving a real pending timeout
    fakeTimers = installFakeTimers()
  })

  afterEach(() => {
    //#given - cancel any still-pending deletion so no timer leaks into the next test file
    for (const id of SESSION_IDS) {
      cancelSyncSessionDeletion(id)
    }
    handedBackSyncSessions.clear()
    fakeTimers.restore()
  })

  test("schedules the deletion with the provided delay", () => {
    //#given - a client whose session.delete resolves
    const { client, deleteMock } = createClient()

    //#when - the deletion is scheduled with an explicit delay
    scheduleSyncSessionDeletion(client, "ses_sscd_a", 120000)

    //#then - exactly one fake timer is recorded carrying that delay
    expect(fakeTimers.timers).toHaveLength(1)
    expect(fakeTimers.timers[0]?.delay).toBe(120000)

    //#when - the recorded callback fires
    fakeTimers.timers[0]?.callback()

    //#then - session.delete is called once for that session id
    expect(deleteMock).toHaveBeenCalledTimes(1)
    expect(deleteMock).toHaveBeenCalledWith({ path: { id: "ses_sscd_a" } })
  })

  test("falls back to TASK_CLEANUP_DELAY_MS when the delay argument is undefined", () => {
    //#given - a client whose session.delete resolves
    const { client } = createClient()

    //#when - the deletion is scheduled without an explicit delay
    scheduleSyncSessionDeletion(client, "ses_sscd_b", undefined)

    //#then - the recorded delay is the module fallback
    expect(fakeTimers.timers).toHaveLength(1)
    expect(fakeTimers.timers[0]?.delay).toBe(TASK_CLEANUP_DELAY_MS)

    //#then - the fallback constant itself is pinned to ten minutes
    expect(TASK_CLEANUP_DELAY_MS).toBe(600000)
  })

  test("cancelSyncSessionDeletion clears the pending timer and prevents the deletion", () => {
    //#given - a scheduled deletion
    const { client, deleteMock } = createClient()
    scheduleSyncSessionDeletion(client, "ses_sscd_c", 120000)
    const scheduledHandle = fakeTimers.timers[0]?.handle

    //#when - the deletion is cancelled for that same session id
    cancelSyncSessionDeletion("ses_sscd_c")

    //#then - the exact recorded timer handle was cleared, so the callback can never fire
    expect(fakeTimers.clearedHandles).toContain(scheduledHandle)

    //#then - the deletion callback never ran and session.delete was never called
    expect(deleteMock).not.toHaveBeenCalled()
  })

  test("removes the session id from handedBackSyncSessions after the deletion resolves", async () => {
    //#given - a handed-back session with a scheduled deletion
    const { client } = createClient()
    handedBackSyncSessions.add("ses_sscd_d")
    scheduleSyncSessionDeletion(client, "ses_sscd_d", 120000)

    //#when - the recorded callback fires and the async delete resolves
    fakeTimers.timers[0]?.callback()
    await Promise.resolve()
    await Promise.resolve()

    //#then - the session is no longer marked as handed back
    expect(handedBackSyncSessions.has("ses_sscd_d")).toBe(false)
  })
})
