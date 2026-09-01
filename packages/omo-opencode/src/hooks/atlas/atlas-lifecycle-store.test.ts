import { describe, expect, test } from "bun:test"
import { AtlasLifecycleStore } from "./atlas-lifecycle-store"

describe("AtlasLifecycleStore", () => {
  test("keeps pending work until its matching after event or terminal session boundary", () => {
    // given
    const store = new AtlasLifecycleStore()
    store.trackTaskCall("call-1", "session-1", { kind: "skip", reason: "explicit_resume" })

    // when
    store.cleanupSession("session-1")

    // then
    expect(store.sizes).toEqual({ sessions: 0, pendingCalls: 0, sessionIndexes: 0, hasPruneInterval: false })
  })

  test("does not allocate session state for pending calls", () => {
    // given
    const store = new AtlasLifecycleStore()

    // when
    store.trackFileCall("call-1", "session-1", "plan.md")

    // then
    expect(store.sizes.sessions).toBe(0)
  })

  test("cleans only the terminal session pending calls", () => {
    // given
    const store = new AtlasLifecycleStore()
    store.trackFileCall("call-1", "session-1", "plan-a.md")
    store.trackTaskCall("call-2", "session-2", { kind: "skip", reason: "explicit_resume" })

    // when
    store.cleanupSession("session-1")

    // then
    expect(store.pendingFilePaths.has("call-1")).toBeFalse()
    expect(store.pendingTaskRefs.has("call-2")).toBeTrue()
  })

  test("disposal clears stores and makes a pending retry callback harmless", () => {
    // given
    const store = new AtlasLifecycleStore()
    const state = store.getOrCreateState("session-1")
    state.pendingRetryTimer = setTimeout(() => store.getOrCreateState("session-1"), 60_000)
    store.trackFileCall("call-1", "session-1", "plan.md")

    // when
    store.dispose()

    // then
    store.getOrCreateState("session-1")
    expect(store.sizes).toEqual({ sessions: 0, pendingCalls: 0, sessionIndexes: 0, hasPruneInterval: false })
  })
})
