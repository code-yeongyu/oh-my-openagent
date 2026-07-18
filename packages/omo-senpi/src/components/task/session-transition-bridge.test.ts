import { describe, expect, it } from "bun:test"

import {
  createCompletionNotifier,
  type CompletionNotifierStore,
  type ParentNotifier,
  type ParentNotifierMessage,
  type TaskRecord,
} from "@oh-my-opencode/senpi-task"

import { TaskRuntimeContext, type ParentTransition } from "./runtime-context"
import { createSessionTransitionBridge, type FlushingNotifier } from "./session-transition-bridge"

function completedRecord(sessionId: string): TaskRecord {
  return {
    task_id: "st_done",
    name: "worker",
    parent_session_id: sessionId,
    root_session_id: sessionId,
    depth: 0,
    execution_mode: "in-process",
    model: "anthropic/claude-sonnet-4-6",
    status: "completed",
    residency_state: "resident",
    created_at: "2026-07-07T00:00:00.000Z",
    updated_at: "2026-07-07T00:00:02.000Z",
    final_response: "done",
    notification: { run_epoch: 0, notified_epoch: -1 },
  }
}

interface FakeStore extends CompletionNotifierStore {
  readonly events: Array<{ taskId: string; type: string }>
  readonly record: () => TaskRecord
}

function fakeStore(initial: TaskRecord): FakeStore {
  let current = initial
  const events: Array<{ taskId: string; type: string }> = []
  return {
    events,
    record: () => current,
    load: () => current,
    replace: (next) => {
      current = next
    },
    appendEvent: (taskId, event) => {
      events.push({ taskId, type: event.type })
      return "evt"
    },
    list: () => ({ records: [current], diagnostics: [] }),
  }
}

function capturingNotifier(): ParentNotifier & { readonly enqueued: ParentNotifierMessage[] } {
  const enqueued: ParentNotifierMessage[] = []
  return {
    enqueued,
    enqueue: (message) => {
      enqueued.push(message)
    },
  }
}

function recordingRuntime(): { runtime: { setTransition(t: ParentTransition): void }; transitions: ParentTransition[] } {
  const transitions: ParentTransition[] = []
  return { runtime: { setTransition: (transition) => transitions.push(transition) }, transitions }
}

describe("createSessionTransitionBridge transition marking", () => {
  it("#given a session about to switch #when onBeforeSwitch fires #then the runtime enters the switching transition", () => {
    // given
    const { runtime, transitions } = recordingRuntime()
    const bridge = createSessionTransitionBridge({ runtime, notifier: stubFlusher() })

    // when
    bridge.onBeforeSwitch("session-a")

    // then
    expect(transitions).toEqual(["session_switching"])
  })

  it("#given a session about to compact #when onBeforeCompact fires #then the runtime enters the compacting transition", () => {
    // given
    const { runtime, transitions } = recordingRuntime()
    const bridge = createSessionTransitionBridge({ runtime, notifier: stubFlusher() })

    // when
    bridge.onBeforeCompact("session-a")

    // then
    expect(transitions).toEqual(["compacting"])
  })

  it("#given a session shutting down #when onShutdown fires #then the runtime enters the shutdown transition", () => {
    // given
    const { runtime, transitions } = recordingRuntime()
    const bridge = createSessionTransitionBridge({ runtime, notifier: stubFlusher() })

    // when
    bridge.onShutdown("session-a")

    // then
    expect(transitions).toEqual(["session_shutdown"])
  })

  it("#given no pending transition #when a fresh session starts #then no flush is attempted", () => {
    // given a flusher that records calls
    const flushes: unknown[] = []
    const notifier: FlushingNotifier = { flushBuffered: (input) => (flushes.push(input), { kind: "empty" }) }
    const bridge = createSessionTransitionBridge({ runtime: recordingRuntime().runtime, notifier })

    // when
    bridge.onSessionStart("session-a")

    // then
    expect(flushes).toHaveLength(0)
  })
})

describe("createSessionTransitionBridge buffered-completion round trip", () => {
  it("#given a completion buffered during compaction #when the same session compacts through #then the buffered completion is flushed and delivered", () => {
    // given a real runtime + real notifier so the full buffer path exercises
    const runtime = new TaskRuntimeContext("/project")
    const store = fakeStore(completedRecord("session-a"))
    const notifier = capturingNotifier()
    const completion = createCompletionNotifier({ notifier, store })
    const bridge = createSessionTransitionBridge({ runtime, notifier: completion })

    // when the session enters compaction and a background terminal arrives
    bridge.onBeforeCompact("session-a")
    const result = completion.notifyTerminal({ record: store.record(), parentState: runtime.parentState(), runInBackground: true })

    // then the completion buffered rather than delivering into a mid-compaction session
    expect(result.kind).toBe("buffered")
    expect(notifier.enqueued).toHaveLength(0)

    // when compaction finishes on the same session
    bridge.onCompact("session-a")

    // then the buffered completion is delivered exactly once and marked notified
    expect(notifier.enqueued).toHaveLength(1)
    expect(store.record().notification.notified_epoch).toBe(0)
    // and the runtime is back out of any transition (idle routing restored)
    expect(runtime.parentState().kind).toBe("idle")
  })

  it("#given a completion buffered before a switch #when a different session replaces it #then the completion is dropped, not delivered", () => {
    // given
    const runtime = new TaskRuntimeContext("/project")
    const store = fakeStore(completedRecord("session-a"))
    const notifier = capturingNotifier()
    const completion = createCompletionNotifier({ notifier, store })
    const bridge = createSessionTransitionBridge({ runtime, notifier: completion })

    // when a switch begins and a completion buffers
    bridge.onBeforeSwitch("session-a")
    completion.notifyTerminal({ record: store.record(), parentState: runtime.parentState(), runInBackground: true })
    expect(notifier.enqueued).toHaveLength(0)

    // when a DIFFERENT session takes over
    bridge.onSessionStart("session-b")

    // then the buffered completion is dropped (never injected into the replacement session)
    expect(notifier.enqueued).toHaveLength(0)
    expect(store.events.some((event) => event.type === "notification_dropped")).toBe(true)
    // and notified_epoch was never advanced
    expect(store.record().notification.notified_epoch).toBe(-1)
  })

  it("#given a completion buffered before a switch #when the same session resumes #then the buffered completion is delivered", () => {
    // given
    const runtime = new TaskRuntimeContext("/project")
    const store = fakeStore(completedRecord("session-a"))
    const notifier = capturingNotifier()
    const completion = createCompletionNotifier({ notifier, store })
    const bridge = createSessionTransitionBridge({ runtime, notifier: completion })

    // when
    bridge.onBeforeSwitch("session-a")
    completion.notifyTerminal({ record: store.record(), parentState: runtime.parentState(), runInBackground: true })
    bridge.onSessionStart("session-a")

    // then
    expect(notifier.enqueued).toHaveLength(1)
    expect(store.record().notification.notified_epoch).toBe(0)
  })
})

function stubFlusher(): FlushingNotifier {
  return { flushBuffered: () => ({ kind: "empty" }) }
}
