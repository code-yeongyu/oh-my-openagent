import { describe, expect, test } from "bun:test"

import { createChildHandle, type ChildSession, type ChildSessionListener } from "./child-handle"

type FakeSessionControls = {
  readonly session: ChildSession
  readonly followUpCalls: string[]
  readonly lastText: { value: string | undefined }
  readonly promptCalls: () => number
  resolvePrompt: () => void
}

// Minimal controllable ChildSession: prompt() resolves on demand (a turn), followUp() records only.
function createFakeSession(sessionId = "child-session-1"): FakeSessionControls {
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

describe("createChildHandle revive", () => {
  test("#given a running child #when followed up mid-turn #then it queues via followUp without starting a new turn", async () => {
    // given a first turn still in flight
    const fake = createFakeSession()
    const handle = createChildHandle({ taskId: "task-1", session: fake.session, promptText: "do the work" })

    // when a follow-up arrives while the agent is busy
    await handle.followUp("more context")

    // then it is queued, not started as a fresh prompt turn
    expect(fake.followUpCalls).toEqual(["more context"])
    expect(fake.promptCalls()).toBe(1)
    fake.lastText.value = "done"
    fake.resolvePrompt()
    expect(await handle.waitForIdle()).toEqual({ status: "completed", finalResponse: "done" })
  })

  test("#given a completed resident child #when revived with a follow-up #then a fresh turn is tracked and waitForIdle reflects the new outcome", async () => {
    // given the first turn has completed and the child is idle/resident
    const fake = createFakeSession()
    const handle = createChildHandle({ taskId: "task-1", session: fake.session, promptText: "do the work" })
    fake.lastText.value = "first"
    fake.resolvePrompt()
    expect(await handle.waitForIdle()).toEqual({ status: "completed", finalResponse: "first" })
    expect(fake.promptCalls()).toBe(1)

    // when a follow-up revives the idle child
    fake.lastText.value = "second"
    await handle.followUp("again")

    // then a fresh turn is driven and waitForIdle re-arms to the SECOND turn's outcome
    expect(fake.promptCalls()).toBe(2)
    fake.resolvePrompt()
    expect(await handle.waitForIdle()).toEqual({ status: "completed", finalResponse: "second" })
  })
})
