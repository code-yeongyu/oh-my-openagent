import { describe, expect, test } from "bun:test"
import { createShutdownDrain } from "./shutdown-drain"
import { DREAM_VOLUME_GATE_BYTES, evaluateDreamGates, resolveDreamTriggerSettings, type DreamTriggerSession } from "./dream-trigger"
import { fireDream } from "./dream-trigger-fire"
import { loadConversations } from "./dream-selector"
import { memorySettings } from "./memory.test-support"
import { CONVERSATION, NOW_MS, fireTimer, fixture, gateProbe, noopSteps, settle, triggerSettings } from "./dream-trigger.test-support"

describe("dream shutdown evaluator", () => {
  test("#given every gate passing #when shutdown fireDream uses an injected loader #then the loader runs exactly once", async () => {
    let loads = 0
    const f = await fixture()
    const outcome = await fireDream({
      session: f.session,
      origin: "shutdown",
      settings: triggerSettings(),
      request: {},
      now: () => NOW_MS,
      warnLaunchFailure: () => {},
      loadConversations: async (transcriptsDir) => {
        loads += 1
        return loadConversations(transcriptsDir)
      },
    })

    expect(outcome.fired).toBe(true)
    expect(loads).toBe(1)
  })

  test("#given every gate passing #when a quit drains through the registered evaluator #then a shutdown dream launches", async () => {
    const f = await fixture()
    const drain = createShutdownDrain({ steps: noopSteps })
    drain.registerEvaluator(f.wiring.shutdownEvaluator())
    await drain.run({ reason: "quit", sessionId: CONVERSATION, deadlineAt: NOW_MS + 30_000, now: () => NOW_MS })
    expect(f.launches).toHaveLength(1)
    expect(f.launches[0]?.request.trigger).toBe("dream")
    expect(f.launches[0]?.request.origin).toBe("shutdown")
  })

  test("#given every gate passing #when a non-quit shutdown drains #then the evaluator never runs", async () => {
    const f = await fixture()
    const drain = createShutdownDrain({ steps: noopSteps })
    drain.registerEvaluator(f.wiring.shutdownEvaluator())
    await drain.run({ reason: "reload", sessionId: CONVERSATION, deadlineAt: NOW_MS + 1500, now: () => NOW_MS })
    expect(f.launches).toHaveLength(0)
    expect(await f.store.readState()).toEqual({})
  })

  test("#given shutdown_launch disabled #when the evaluator runs #then no reservation is made", async () => {
    const f = await fixture({ settings: { shutdownLaunch: false } })
    await f.wiring.shutdownEvaluator()({
      reason: "quit",
      sessionId: CONVERSATION,
      deadlineAt: NOW_MS + 1500,
      signal: new AbortController().signal,
    })
    expect(f.launches).toHaveLength(0)
    expect(await f.store.readState()).toEqual({})
  })

  test("#given a dream one hour ago #when the evaluator runs #then the spacing gate blocks the launch", async () => {
    const f = await fixture({ lastDreamAt: new Date(NOW_MS - 3_600_000).toISOString() })
    await f.wiring.shutdownEvaluator()({
      reason: "quit",
      sessionId: CONVERSATION,
      deadlineAt: NOW_MS + 1500,
      signal: new AbortController().signal,
    })
    expect(f.launches).toHaveLength(0)
    expect(await f.store.readState()).toEqual({})
  })

  test("#given a pre-aborted drain signal #when the evaluator runs #then no reservation is made", async () => {
    const f = await fixture()
    const controller = new AbortController()
    controller.abort()
    await f.wiring.shutdownEvaluator()({
      reason: "quit",
      sessionId: CONVERSATION,
      deadlineAt: NOW_MS + 1500,
      signal: controller.signal,
    })
    expect(f.launches).toHaveLength(0)
    expect(await f.store.readState()).toEqual({})
  })

  test("#given abort arrives while shutdown reservation is in flight #when the reservation returns active #then no dream child launch starts", async () => {
    let releaseReservation: (() => void) | undefined
    const reservationReleased = new Promise<void>((resolve) => { releaseReservation = resolve })
    let signalReservationStarted: (() => void) | undefined
    const reservationStarted = new Promise<void>((resolve) => { signalReservationStarted = resolve })
    let reserve: DreamTriggerSession["store"]["tryReserve"] | undefined
    const f = await fixture({
      reservationStore: {
        tryReserve: async (request, signal) => {
          signalReservationStarted?.()
          await reservationReleased
          if (reserve === undefined) throw new Error("reservation delegate unavailable")
          return reserve(request, signal)
        },
      },
    })
    reserve = f.store.tryReserve.bind(f.store)
    const controller = new AbortController()
    const evaluating = f.wiring.shutdownEvaluator()({
      reason: "quit",
      sessionId: CONVERSATION,
      deadlineAt: NOW_MS + 1500,
      signal: controller.signal,
    })
    await Promise.race([
      reservationStarted,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("shutdown reservation did not start")), 2_000)),
    ])

    controller.abort()
    releaseReservation?.()
    await evaluating

    expect(f.launches).toHaveLength(0)
    expect(await f.store.readState()).toEqual({})
  })

  test("#given abort after the first snapshot #when multiple conversations were selected #then later snapshots never start", async () => {
    // given
    const f = await fixture()
    const controller = new AbortController()
    let releaseSnapshot: (() => void) | undefined
    const snapshotReleased = new Promise<void>((resolve) => { releaseSnapshot = resolve })
    let signalSnapshotStarted: (() => void) | undefined
    const snapshotStarted = new Promise<void>((resolve) => { signalSnapshotStarted = resolve })
    let secondSnapshots = 0
    const snapshot = {
      start_message_id: "start",
      end_message_id: "end",
      start_line: 0,
      end_snapshot_line: 1,
      entries: [],
    }
    const session: DreamTriggerSession = {
      conversationId: CONVERSATION,
      identity: f.identity.id,
      identityPaths: f.identity.paths,
      getJournal: async (conversationId) => ({
        captureReflectionSnapshot: async () => {
          if (conversationId === "first") {
            signalSnapshotStarted?.()
            await snapshotReleased
          } else {
            secondSnapshots += 1
          }
          return snapshot
        },
      }),
      store: f.store,
      launch: (run) => f.launches.push(run),
    }
    const firing = fireDream({
      session,
      origin: "manual",
      settings: triggerSettings(),
      request: { conversationIds: ["first", "second"], signal: controller.signal },
      now: () => NOW_MS,
      warnLaunchFailure: () => {},
    })
    await snapshotStarted

    // when
    controller.abort()
    releaseSnapshot?.()
    const result = await firing

    // then
    expect(result).toEqual({ fired: false, rejection: "aborted" })
    expect(secondSnapshots).toBe(0)
    expect(await f.store.readState()).toEqual({})
  })

  test("#given the clock crosses the shutdown deadline during reservation #when reservation returns #then launch never starts", async () => {
    // given
    let clock = NOW_MS
    let reserve: DreamTriggerSession["store"]["tryReserve"] | undefined
    const f = await fixture({
      now: () => clock,
      reservationStore: {
        tryReserve: async (request, signal) => {
          if (reserve === undefined) throw new Error("reservation delegate unavailable")
          const result = await reserve(request, signal)
          clock = NOW_MS + 1_501
          return result
        },
      },
    })
    reserve = f.store.tryReserve.bind(f.store)

    // when
    await f.wiring.shutdownEvaluator()({
      reason: "quit",
      sessionId: CONVERSATION,
      deadlineAt: NOW_MS + 1_500,
      signal: new AbortController().signal,
    })

    // then
    expect(f.launches).toHaveLength(0)
  })
})
