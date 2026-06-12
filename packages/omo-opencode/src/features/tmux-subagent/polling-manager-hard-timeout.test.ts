import { describe, test, expect } from "bun:test"
import { TmuxPollingManager } from "./polling-manager"
import { SESSION_TIMEOUT_MS } from "../../shared/tmux"
import type { OpencodeClient } from "../../tools/delegate-task/types"
import type { TrackedSession } from "./types"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"

function createTrackedSession(sessionId: string, createdAt: Date): TrackedSession {
  return {
    sessionId,
    paneId: "%1",
    description: "test",
    attachActivated: false,
    createdAt,
    lastSeenAt: createdAt,
    closePending: false,
    closeRetryCount: 0,
  }
}

function createStatuslessClient(): OpencodeClient {
  return unsafeTestValue<OpencodeClient>({
    session: {
      status: async () => ({ data: {} }),
      messages: async () => ({ data: [] }),
    },
  })
}

describe("TmuxPollingManager never-activated pane hard timeout (#4773, #5071)", () => {
  test("closes a never-focused pane with no session status once SESSION_TIMEOUT_MS elapses", async () => {
    //#given a pane past the hard timeout that was never attach-activated and never reported a status
    const pastHardTimeout = new Date(Date.now() - SESSION_TIMEOUT_MS - 60_000)
    const sessions = new Map<string, TrackedSession>()
    sessions.set("ses-unfocused-timed-out", createTrackedSession("ses-unfocused-timed-out", pastHardTimeout))

    const closedSessionIds: string[] = []
    const manager = new TmuxPollingManager(createStatuslessClient(), sessions, async (sessionId) => {
      closedSessionIds.push(sessionId)
    })

    //#when
    await unsafeTestValue<{ pollSessions: () => Promise<void> }>(manager).pollSessions()

    //#then
    expect(closedSessionIds).toEqual(["ses-unfocused-timed-out"])
  })

  test("keeps a young never-focused pane with no session status open", async () => {
    //#given a 30s-old placeholder pane that was never attach-activated and has no status yet
    const thirtySecondsAgo = new Date(Date.now() - 30_000)
    const sessions = new Map<string, TrackedSession>()
    sessions.set("ses-unfocused-young", createTrackedSession("ses-unfocused-young", thirtySecondsAgo))

    const closedSessionIds: string[] = []
    const manager = new TmuxPollingManager(createStatuslessClient(), sessions, async (sessionId) => {
      closedSessionIds.push(sessionId)
    })

    //#when
    await unsafeTestValue<{ pollSessions: () => Promise<void> }>(manager).pollSessions()

    //#then
    expect(closedSessionIds).toEqual([])
  })
})
