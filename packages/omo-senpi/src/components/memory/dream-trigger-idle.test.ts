import { describe, expect, test } from "bun:test"
import { createShutdownDrain } from "./shutdown-drain"
import { DREAM_VOLUME_GATE_BYTES, evaluateDreamGates, resolveDreamTriggerSettings } from "./dream-trigger"
import { memorySettings } from "./memory.test-support"
import { CONVERSATION, IDLE_MS, NOW_MS, fireTimer, fixture, gateProbe, noopSteps, settle, triggerSettings } from "./dream-trigger.test-support"

describe("dream idle timer matrix", () => {
  test("#given a settled agent #when the settle event arrives #then an idle timer is armed for idle_minutes", async () => {
    const f = await fixture()
    await settle(f)
    expect(f.scheduler.scheduled).toHaveLength(1)
    expect(f.scheduler.latest().delayMs).toBe(IDLE_MS)
  })

  test("#given an armed idle timer #when the agent settles again #then the first timer is cancelled and a fresh one armed", async () => {
    const f = await fixture()
    await settle(f)
    const first = f.scheduler.latest()
    await settle(f)
    expect(first.cancelled).toBe(true)
    expect(f.scheduler.scheduled).toHaveLength(2)
    expect(f.scheduler.latest().cancelled).toBe(false)
  })

  test("#given an armed idle timer #when an input event arrives #then the timer resets and the next settle re-arms", async () => {
    const f = await fixture()
    await settle(f)
    const armed = f.scheduler.latest()
    await f.pi.dispatch("input", { type: "input" }, f.eventCtx)
    expect(armed.cancelled).toBe(true)
    armed.fire()
    await f.wiring.whenIdle()
    expect(f.launches).toHaveLength(0)
    await settle(f)
    expect(f.scheduler.scheduled).toHaveLength(2)
    await fireTimer(f)
    expect(f.launches).toHaveLength(1)
    expect(f.launches[0]?.request.origin).toBe("idle")
  })

  test("#given an armed idle timer #when an agent_start event arrives #then the timer resets and the next settle re-arms", async () => {
    const f = await fixture()
    await settle(f)
    const armed = f.scheduler.latest()
    await f.pi.dispatch("agent_start", { type: "agent_start" }, f.eventCtx)
    expect(armed.cancelled).toBe(true)
    armed.fire()
    await f.wiring.whenIdle()
    expect(f.launches).toHaveLength(0)
    await settle(f)
    await fireTimer(f)
    expect(f.launches).toHaveLength(1)
  })

  test("#given an armed idle timer #when a session_compact event arrives #then the timer resets and the next settle re-arms", async () => {
    const f = await fixture()
    await settle(f)
    const armed = f.scheduler.latest()
    await f.pi.dispatch("session_compact", { type: "session_compact" }, f.eventCtx)
    expect(armed.cancelled).toBe(true)
    armed.fire()
    await f.wiring.whenIdle()
    expect(f.launches).toHaveLength(0)
    await settle(f)
    await fireTimer(f)
    expect(f.launches).toHaveLength(1)
  })

  test("#given an armed idle timer #when the session shuts down #then the timer is cancelled and a stale fire launches nothing", async () => {
    const f = await fixture()
    await settle(f)
    const armed = f.scheduler.latest()
    await f.pi.dispatch("session_shutdown", { type: "session_shutdown" }, f.eventCtx)
    expect(armed.cancelled).toBe(true)
    armed.fire()
    await f.wiring.whenIdle()
    expect(f.launches).toHaveLength(0)
    expect(await f.store.readState()).toEqual({})
  })

  test("#given an armed idle timer #when the session aborts #then the timer is cancelled and a stale fire launches nothing", async () => {
    const f = await fixture()
    await settle(f)
    const armed = f.scheduler.latest()
    await f.pi.dispatch("session_abort", { type: "session_abort" }, f.eventCtx)
    expect(armed.cancelled).toBe(true)
    armed.fire()
    await f.wiring.whenIdle()
    expect(f.launches).toHaveLength(0)
    expect(await f.store.readState()).toEqual({})
  })

  test("#given idle_minutes zero #when the agent settles #then no timer is armed", async () => {
    const f = await fixture({ settings: { idleMinutes: 0 } })
    await settle(f)
    expect(f.scheduler.scheduled).toHaveLength(0)
  })

  test("#given an armed idle timer #when it fires while the agent is streaming #then no dream is requested", async () => {
    const f = await fixture()
    await settle(f)
    f.idleState.isIdle = false
    await fireTimer(f)
    expect(f.launches).toHaveLength(0)
    expect(await f.store.readState()).toEqual({})
  })

  test("#given an armed idle timer #when it fires with pending messages #then no dream is requested", async () => {
    const f = await fixture()
    await settle(f)
    f.idleState.hasPending = true
    await fireTimer(f)
    expect(f.launches).toHaveLength(0)
    expect(await f.store.readState()).toEqual({})
  })

  test("#given a timer armed from a context without idle probes #when it fires #then no dream is requested", async () => {
    const f = await fixture()
    await settle(f, {})
    await fireTimer(f)
    expect(f.launches).toHaveLength(0)
    expect(await f.store.readState()).toEqual({})
  })
})

describe("automatic dream gates", () => {
  test("#given dream disabled #when the idle timer fires #then no reservation is made", async () => {
    const f = await fixture({ settings: { enabled: false } })
    await settle(f)
    await fireTimer(f)
    expect(f.launches).toHaveLength(0)
    expect(await f.store.readState()).toEqual({})
  })

  test("#given a dream one hour ago #when the idle timer fires #then the spacing gate blocks the launch", async () => {
    const f = await fixture({ lastDreamAt: new Date(NOW_MS - 3_600_000).toISOString() })
    await settle(f)
    await fireTimer(f)
    expect(f.launches).toHaveLength(0)
    expect(await f.store.readState()).toEqual({})
  })

  test("#given unreflected volume exactly at the floor #when the idle timer fires #then the volume gate blocks the launch", async () => {
    const f = await fixture({ conversationText: "x".repeat(DREAM_VOLUME_GATE_BYTES) })
    await settle(f)
    await fireTimer(f)
    expect(f.launches).toHaveLength(0)
    expect(await f.store.readState()).toEqual({})
  })

  test("#given every gate passing #when the idle timer fires #then a dream run is reserved and launched", async () => {
    const f = await fixture({ conversationText: "x".repeat(DREAM_VOLUME_GATE_BYTES + 1) })
    await settle(f)
    await fireTimer(f)
    expect(f.launches).toHaveLength(1)
    expect(f.launches[0]?.request.trigger).toBe("dream")
    expect(f.launches[0]?.request.origin).toBe("idle")
    expect(f.launches[0]?.request.conversationIds).toEqual([CONVERSATION])
    expect(f.launches[0]?.request.snapshots).toHaveLength(1)
    const state = await f.store.readState()
    expect(state.active?.request.trigger).toBe("dream")
  })
})
