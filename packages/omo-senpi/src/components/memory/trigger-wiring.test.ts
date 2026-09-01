import { describe, expect, test } from "bun:test"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createReflectionTriggerWiring, type ReflectionTriggerSession } from "./trigger-wiring"
import { CONVERSATION, compact, fixture, successfulSettle, agentEnd, settle } from "./trigger-wiring.test-support"

describe("reflection trigger wiring compaction observers", () => {
  test("#given an accepted compaction #when the event fires #then the observer is told which conversation was rewritten", async () => {
    // given: the memorian gate drops that session's pending nudges here - they judged a
    // transcript the compaction has just replaced
    const observed: string[] = []
    const { pi } = await fixture({ stepCount: 0, onCompactionAccepted: (conversationId) => observed.push(conversationId) })

    // when
    await compact(pi, true)

    // then
    expect(observed).toEqual([CONVERSATION])
  })

  test("#given a rejected compaction #when the event fires #then the observer never runs", async () => {
    // given
    const observed: string[] = []
    const { pi } = await fixture({ stepCount: 0, onCompactionAccepted: (conversationId) => observed.push(conversationId) })

    // when
    await compact(pi, false)

    // then
    expect(observed).toEqual([])
  })

  test("#given an observer that throws #when a compaction is accepted #then the reflection flag is still recorded", async () => {
    // given
    const { pi, ledger } = await fixture({
      stepCount: 0,
      onCompactionAccepted: () => {
        throw new Error("observer exploded")
      },
    })

    // when
    await compact(pi, true)

    // then
    expect(ledger.pendingCompaction).toBe(true)
  })
})

describe("reflection trigger wiring", () => {
  test("#given a met step threshold #when a clean run settles #then exactly one step-count launch fires with no visible message", async () => {
    const { pi, launches, store } = await fixture({ stepCount: 1 })

    await successfulSettle(pi)

    expect(launches).toHaveLength(1)
    expect(launches[0]?.trigger).toBe("step-count")
    expect(launches[0]?.conversationIds).toEqual([CONVERSATION])
    expect(launches[0]?.snapshots[0]?.snapshot.end_message_id).toBe("assistant-2")
    expect((await store.readState()).active?.request.trigger).toBe("step-count")
    expect(pi.messages).toEqual([])
    expect(pi.userMessages).toEqual([])
  })

  test("#given the wiring #when registered #then it observes only agent_end, agent_settled and session_compact", async () => {
    const { pi } = await fixture()

    expect(pi.handlers.map((registration) => registration.event)).toEqual([
      "agent_end",
      "agent_settled",
      "session_compact",
    ])
    expect(pi.commands).toEqual([])
    expect(pi.tools).toEqual([])
  })

  test("#given a zero step threshold #when a clean run settles #then nothing ever launches", async () => {
    const { pi, launches, store } = await fixture({ stepCount: 0, onCompaction: false, steps: 5 })

    await successfulSettle(pi)

    expect(launches).toEqual([])
    expect((await store.readState()).active).toBeUndefined()
  })

  test("#given an unsuccessful or missing run outcome #when settled #then no launch is attempted", async () => {
    for (const scenario of [
      { name: "aborted", payload: { aborted: true, abortSource: "user" as const } },
      { name: "willRetry", payload: { willRetry: true } },
      { name: "aborted-and-retrying", payload: { aborted: true, willRetry: true } },
    ]) {
      const { pi, launches, store } = await fixture({ stepCount: 1 })

      await agentEnd(pi, scenario.payload)
      await settle(pi)

      expect(launches, scenario.name).toEqual([])
      expect((await store.readState()).active, scenario.name).toBeUndefined()
    }

    const bare = await fixture({ stepCount: 1 })
    await settle(bare.pi)
    expect(bare.launches).toEqual([])
    expect((await bare.store.readState()).active).toBeUndefined()
  })

  test("#given a retried run #when the final agent_end is clean #then the settle counts as success", async () => {
    const { pi, launches } = await fixture({ stepCount: 1 })

    await agentEnd(pi, { willRetry: true })
    await agentEnd(pi)
    await settle(pi)

    expect(launches).toHaveLength(1)
    expect(launches[0]?.trigger).toBe("step-count")
  })

  test("#given a settled run outcome #when a second settle arrives without a new run #then the stale outcome cannot relaunch", async () => {
    const { pi, launches } = await fixture({ stepCount: 1, onCompaction: false })

    await successfulSettle(pi)
    await settle(pi)

    expect(launches).toHaveLength(1)
  })

  test("#given an accepted compaction #when the event fires #then it only records the pending flag and never launches", async () => {
    const { pi, ledger, launches, store } = await fixture({ stepCount: 0 })

    await compact(pi, true)

    expect(ledger.pendingCompaction).toBe(true)
    expect(launches).toEqual([])
    expect((await store.readState()).active).toBeUndefined()
    expect(pi.messages).toEqual([])
  })

  test("#given a rejected compaction #when the event fires #then no pending flag is recorded", async () => {
    const { pi, ledger, launches } = await fixture({ stepCount: 0 })

    await compact(pi, false)
    await successfulSettle(pi)

    expect(ledger.pendingCompaction).toBe(false)
    expect(launches).toEqual([])
  })

  test("#given a pending compaction #when the next settle fails and only then succeeds #then the flag is consumed exactly once", async () => {
    const { pi, ledger, launches } = await fixture({ stepCount: 0 })

    await compact(pi, true)
    await agentEnd(pi, { aborted: true })
    await settle(pi)

    expect(launches).toEqual([])
    expect(ledger.pendingCompaction).toBe(true)

    await successfulSettle(pi)

    expect(launches).toHaveLength(1)
    expect(launches[0]?.trigger).toBe("compaction")
    expect(ledger.pendingCompaction).toBe(false)

    await successfulSettle(pi)

    expect(launches).toHaveLength(1)
  })

  test("#given compaction and the step threshold ready in the same settle #when it is evaluated #then exactly one run launches", async () => {
    const { pi, launches, store } = await fixture({ stepCount: 1, steps: 3 })

    await compact(pi, true)
    await successfulSettle(pi)

    expect(launches).toHaveLength(1)
    expect(launches[0]?.trigger).toBe("compaction")
    expect((await store.readState()).active?.request.trigger).toBe("compaction")
    expect((await store.readState()).pending).toBeUndefined()
  })

  test("#given repeated successful settles before the active run completes #when they are evaluated #then one launch fires and pending collapses to a single record", async () => {
    const { pi, launches, store } = await fixture({ stepCount: 1, steps: 3 })

    await successfulSettle(pi)
    await compact(pi, true)
    await successfulSettle(pi)
    await successfulSettle(pi)
    await successfulSettle(pi)

    const state = await store.readState()
    expect(launches).toHaveLength(1)
    expect(launches[0]?.trigger).toBe("step-count")
    expect(state.active?.request.trigger).toBe("step-count")
    expect(state.pending?.request.trigger).toBe("compaction")
  })

  test("#given a manual request #when it is made outside any event #then it launches with its focus and journal filters", async () => {
    const { launches, wiring } = await fixture({ stepCount: 0 })

    wiring.requestManualReflection("remember names", { recentN: 3, conversationIds: [CONVERSATION] })
    await wiring.whenIdle()

    expect(launches).toHaveLength(1)
    expect(launches[0]).toMatchObject({
      trigger: "manual",
      focus: "remember names",
      recentN: 3,
      conversationIds: [CONVERSATION],
    })
  })

  test("#given a manual request without arguments #when it is made #then it targets the bound conversation without a focus", async () => {
    const { launches, wiring } = await fixture({ stepCount: 0 })

    wiring.requestManualReflection()
    await wiring.whenIdle()

    expect(launches).toHaveLength(1)
    expect(launches[0]?.trigger).toBe("manual")
    expect(launches[0]?.conversationIds).toEqual([CONVERSATION])
    expect(launches[0]?.focus).toBeUndefined()
  })

  test("#given an active run #when a manual request queues behind it #then it is reserved as pending without launching", async () => {
    const { pi, launches, store, wiring } = await fixture({ stepCount: 1 })

    await successfulSettle(pi)
    wiring.requestManualReflection("later")
    await wiring.whenIdle()

    expect(launches).toHaveLength(1)
    expect((await store.readState()).pending?.request.trigger).toBe("manual")
  })

  test("#given a launch handler that never settles #when a run settles #then the event handler still completes", async () => {
    const { pi } = await fixture({ stepCount: 1, onLaunch: () => new Promise<never>(() => {}) })

    const dispatched = await pi.dispatch("agent_end", { type: "agent_end", messages: [] }).then(() => settle(pi)).then(() => "completed")

    expect(dispatched).toBe("completed")
  })

  test("#given no launch handler #when a run settles #then the reservation still happens without throwing", async () => {
    const { pi, store } = await fixture({ stepCount: 1, withoutLaunchHandler: true })

    await successfulSettle(pi)

    expect((await store.readState()).active?.request.trigger).toBe("step-count")
  })

  test("#given no bound memory session #when events fire #then the wiring stays inert", async () => {
    const { pi, launches, logs, wiring } = await fixture({ stepCount: 1, session: undefined })

    await compact(pi, true)
    await successfulSettle(pi)
    wiring.requestManualReflection("ignored")
    await wiring.whenIdle()

    expect(launches).toEqual([])
    expect(logs).toEqual([])
  })

  test("#given an engine failure #when a run settles #then the host handler resolves and the failure is logged once", async () => {
    const base = await fixture({ stepCount: 1 })
    const session: ReflectionTriggerSession = {
      conversationId: "missing-conversation",
      ledger: base.ledger,
      engine: base.store,
    }
    const pi = new FakeExtensionAPI()
    const logs: Array<{ level: string; message: string; details?: unknown }> = []
    createReflectionTriggerWiring({
      resolveSession: () => session,
      onLaunch: () => {
        throw new Error("must not launch")
      },
      logger: {
        info: (message, details) => logs.push({ level: "info", message, details }),
        warn: (message, details) => logs.push({ level: "warn", message, details }),
        error: (message, details) => logs.push({ level: "error", message, details }),
      },
    }).register(pi)

    await successfulSettle(pi)

    expect(logs.filter((entry) => entry.level === "warn")).toHaveLength(1)
    expect(base.launches).toEqual([])
  })

  test("#given reflection disabled #when a clean run settles #then no reservation is made and no launch fires", async () => {
    const { pi, launches, store } = await fixture({ stepCount: 1, enabled: false })

    await successfulSettle(pi)

    expect(launches).toEqual([])
    expect((await store.readState()).active).toBeUndefined()
  })

  test("#given reflection disabled #when a pending compaction is consumed at settle #then no compaction launch fires", async () => {
    const { pi, launches, store, ledger } = await fixture({ stepCount: 1, enabled: false })

    await compact(pi, true)
    await successfulSettle(pi)

    expect(ledger.pendingCompaction).toBe(false)
    expect(launches).toEqual([])
    expect((await store.readState()).active).toBeUndefined()
  })

  test("#given reflection disabled #when a manual request is made #then no launch fires", async () => {
    const { launches, wiring } = await fixture({ stepCount: 0, enabled: false })

    wiring.requestManualReflection("ignored")
    await wiring.whenIdle()

    expect(launches).toEqual([])
  })

  test("#given reflection enabled #when a clean run settles #then the launch fires exactly as before", async () => {
    const { pi, launches } = await fixture({ stepCount: 1, enabled: true })

    await successfulSettle(pi)

    expect(launches).toHaveLength(1)
    expect(launches[0]?.trigger).toBe("step-count")
  })
})
