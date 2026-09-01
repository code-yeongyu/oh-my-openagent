import { describe, expect, test } from "bun:test"

import { createRestoredChildHandle, type ChildSession, type ChildSessionListener } from "./child-handle"

type FakeSessionControls = {
  readonly session: ChildSession
  readonly followUpCalls: string[]
  readonly lastText: { value: string | undefined }
  promptCalls: () => number
  resolvePrompt: () => void
}

// Minimal controllable ChildSession, mirroring child-handle-revive.test.ts: prompt() is a turn
// that settles on demand; followUp() only records.
function createFakeSession(sessionId = "restored-session-1"): FakeSessionControls {
  const followUpCalls: string[] = []
  const lastText = { value: undefined as string | undefined }
  const counters = { promptCalls: 0 }
  let settle: (() => void) | undefined
  const session: ChildSession = {
    sessionId,
    prompt() {
      counters.promptCalls += 1
      return new Promise<void>((resolve) => {
        settle = resolve
      })
    },
    async steer() {},
    async followUp(text: string) {
      followUpCalls.push(text)
    },
    async abort() {},
    subscribe(_listener: ChildSessionListener) {
      return () => {}
    },
    getLastAssistantText() {
      return lastText.value
    },
    dispose() {},
  }
  return {
    session,
    followUpCalls,
    lastText,
    promptCalls: () => counters.promptCalls,
    resolvePrompt: () => settle?.(),
  }
}

describe("createRestoredChildHandle", () => {
  test("#given a restored session with prior assistant output #when the handle is created #then no prompt is replayed and waitForIdle drains the transcript outcome", async () => {
    // given a session whose persisted transcript ended with assistant text
    const fake = createFakeSession()
    fake.lastText.value = "previous result"

    // when the restored handle is created
    const handle = createRestoredChildHandle({ taskId: "task-1", session: fake.session })

    // then the original prompt is NOT replayed, and the idle handle settles on the transcript outcome
    expect(fake.promptCalls()).toBe(0)
    expect(await handle.waitForIdle()).toEqual({ status: "completed", finalResponse: "previous result" })
  })

  test("#given a restored session without assistant output #when waitForIdle is awaited #then a typed empty-turn outcome settles instead of hanging", async () => {
    // given a transcript with no assistant text (nothing durable to drain)
    const fake = createFakeSession()
    const handle = createRestoredChildHandle({ taskId: "task-1", session: fake.session })

    // when the idle outcome is awaited
    const outcome = await handle.waitForIdle()

    // then it settles as a typed child-turn failure rather than a fabricated completion
    expect(outcome.status).toBe("error")
    if (outcome.status === "error") {
      expect(outcome.failure.kind).toBe("child-turn-failed")
    }
    expect(fake.promptCalls()).toBe(0)
  })

  test("#given an idle restored handle #when a follow-up arrives #then a fresh tracked turn starts from the follow-up text", async () => {
    // given a restored idle handle
    const fake = createFakeSession()
    fake.lastText.value = "previous result"
    const handle = createRestoredChildHandle({ taskId: "task-1", session: fake.session })

    // when a follow-up revives it
    await handle.followUp("continue the work")

    // then a FRESH prompt turn starts (not a queued in-turn follow-up)
    expect(fake.promptCalls()).toBe(1)
    expect(fake.followUpCalls).toEqual([])
    fake.lastText.value = "new result"
    fake.resolvePrompt()
    expect(await handle.waitForIdle()).toEqual({ status: "completed", finalResponse: "new result" })
  })

  test("#given a restored handle with a turn in flight #when a follow-up arrives #then it queues on the session exactly like a live resident", async () => {
    // given a restored handle whose revival turn is running
    const fake = createFakeSession()
    const handle = createRestoredChildHandle({ taskId: "task-1", session: fake.session })
    await handle.followUp("first")

    // when another follow-up arrives mid-turn
    await handle.followUp("second")

    // then it is queued via the session follow-up channel, not started as a parallel turn
    expect(fake.promptCalls()).toBe(1)
    expect(fake.followUpCalls).toEqual(["second"])
    fake.lastText.value = "done"
    fake.resolvePrompt()
    expect(await handle.waitForIdle()).toEqual({ status: "completed", finalResponse: "done" })
  })
})
