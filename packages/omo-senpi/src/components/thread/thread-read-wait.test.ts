import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test"
import type { ThreadToolResult } from "./contracts"
import type { SessionWatchHandlers } from "./control/wait-settled"
import type { RemoteWatchEnd } from "./remote/ports"
import { createRemoteThreadFixture, ENGINE } from "./thread-remote-fixture"

const { account, surface, cleanup } = createRemoteThreadFixture()
// Time is the clock the wait runs on: its deadline and the 3 s quiet window are driven virtually, never waited out.
beforeEach(() => {
  jest.useFakeTimers()
})
afterEach(async () => {
  jest.useRealTimers()
  await cleanup()
})

type Leg = "local" | "remote"
const LEGS: readonly Leg[] = ["local", "remote"]

/**
 * One read shape on both legs (#13417): the same `thread_read { thread, wait_ms }` against the thread this device's
 * endpoint holds (`dur-local`, watched on the endpoint's session subscription) and b's (`dur-on-b`, on the remote watch).
 */
function waitingRead(leg: Leg, streaming: boolean) {
  const engine = { ...ENGINE, streaming }
  if (leg === "local") {
    const here = surface(undefined, { engine })
    return {
      read: (wait_ms: number) => here.run("thread_read", { thread: "dur-local", wait_ms }),
      identity: { thread: "dur-local" },
      watchers: here.watchers as Set<SessionWatchHandlers>,
      watching: here.watching,
      endWatches: here.endWatches,
      otherEnd: "connection_closed",
    }
  }
  const b = account({ engine })
  return {
    read: (wait_ms: number) => surface(b.remote).run("thread_read", { thread: "dur-on-b", wait_ms }),
    identity: { thread: "dur-on-b", device: "b" },
    watchers: b.watchers as Set<SessionWatchHandlers>,
    watching: b.watching,
    endWatches: (reason: string) => b.endWatches(reason as RemoteWatchEnd),
    otherEnd: "listener_failed",
  }
}

// A read that answers before any watch opened never waited: it fails with that answer instead of hanging.
async function opened(watching: Promise<void>, reading: Promise<ThreadToolResult>): Promise<void> {
  await Promise.race([
    watching,
    reading.then((answer) => {
      throw new Error(`thread_read answered without opening a watch: ${JSON.stringify(answer)}`)
    }),
  ])
  await drain()
}

// The wait arms its quiet window once the watch has answered; the continuations in between are microtasks, not time.
async function drain(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
}

function tracked(reading: Promise<ThreadToolResult>) {
  const state: { result?: ThreadToolResult } = {}
  void reading.then((result) => {
    state.result = result
  })
  return state
}

describe("thread_read wait_ms answers the same wait outcomes on this device and on another one (#13417)", () => {
  test.each(LEGS)(
    "#given a %s thread that reads idle and shows no run #when thread_read waits #then it settles idle exactly at the quiet window, with the transcript, and stops its watch",
    async (leg) => {
      const w = waitingRead(leg, false)
      const reading = w.read(60_000)
      const state = tracked(reading)
      await opened(w.watching, reading)
      jest.advanceTimersByTime(2_999)
      await drain()
      expect(state.result).toBeUndefined()
      jest.advanceTimersByTime(1)
      const read = await reading
      expect(read).toMatchObject({
        kind: "ok",
        ...w.identity,
        wait: { outcome: "settled", status: "idle", waited_ms: 3_000 },
      })
      expect((read as { wait?: Record<string, unknown> }).wait).not.toHaveProperty("turn_id")
      expect((read as { items?: unknown[] }).items?.length).toBeGreaterThan(0)
      expect(w.watchers.size).toBe(0)
    },
  )

  test.each(LEGS)(
    "#given a %s thread whose snapshot still reads idle when a run starts #when the quiet window passes mid-run #then the wait settles only at the observed turn end, with its turn id",
    async (leg) => {
      const w = waitingRead(leg, false)
      const reading = w.read(60_000)
      const state = tracked(reading)
      await opened(w.watching, reading)
      for (const handlers of [...w.watchers]) {
        handlers.record({ type: "agent_start", turnId: "7" })
        handlers.status?.({ from: "idle", to: "running", derived: false, cause: "prompt" })
      }
      jest.advanceTimersByTime(10_000)
      await drain()
      expect(state.result).toBeUndefined()
      for (const handlers of [...w.watchers]) {
        handlers.record({ type: "agent_settled", turnId: "7" })
        handlers.status?.({ from: "running", to: "idle", derived: false, cause: "agent_end" })
      }
      expect(await reading).toMatchObject({
        kind: "ok",
        ...w.identity,
        wait: { outcome: "settled", status: "idle", turn_id: "7", waited_ms: 10_000 },
      })
    },
  )

  test.each(LEGS)(
    "#given a %s idle thread that writes records belonging to no run #when thread_read waits #then it still settles idle at the quiet window",
    async (leg) => {
      const w = waitingRead(leg, false)
      const reading = w.read(8_000)
      await opened(w.watching, reading)
      for (const handlers of [...w.watchers]) {
        handlers.record({ type: "agent_idle" })
        handlers.record({ type: "entry_appended" })
      }
      jest.advanceTimersByTime(3_000)
      expect(await reading).toMatchObject({ kind: "ok", wait: { outcome: "settled", status: "idle" } })
    },
  )

  test.each(LEGS)(
    "#given a running %s thread #when its status changes to idle during the wait #then the read settles idle and the watch is stopped",
    async (leg) => {
      const w = waitingRead(leg, true)
      const reading = w.read(60_000)
      await opened(w.watching, reading)
      for (const handlers of [...w.watchers]) handlers.status?.({ from: "running", to: "idle", derived: false })
      expect(await reading).toMatchObject({ kind: "ok", ...w.identity, wait: { outcome: "settled", status: "idle" } })
      expect(w.watchers.size).toBe(0)
    },
  )

  test.each(LEGS)(
    "#given a %s thread that keeps running #when wait_ms passes #then the read answers timeout with running and still returns the transcript",
    async (leg) => {
      const w = waitingRead(leg, true)
      const reading = w.read(1_000)
      await opened(w.watching, reading)
      jest.advanceTimersByTime(1_000)
      const read = await reading
      expect(read).toMatchObject({ kind: "ok", wait: { outcome: "timeout", status: "running", waited_ms: 1_000 } })
      expect((read as { items?: unknown[] }).items?.length).toBeGreaterThan(0)
    },
  )

  test.each(LEGS)(
    "#given a running %s thread #when its session closes during the wait #then the read settles with closed",
    async (leg) => {
      const w = waitingRead(leg, true)
      const reading = w.read(60_000)
      await opened(w.watching, reading)
      w.endWatches("session_closed")
      expect(await reading).toMatchObject({ kind: "ok", wait: { outcome: "settled", status: "closed" } })
    },
  )

  test.each(LEGS)(
    "#given a running %s thread #when its watch ends for any other reason #then the read answers ended, naming the reason",
    async (leg) => {
      const w = waitingRead(leg, true)
      const reading = w.read(60_000)
      await opened(w.watching, reading)
      w.endWatches(w.otherEnd)
      expect(await reading).toMatchObject({ kind: "ok", wait: { outcome: "ended", status: w.otherEnd } })
    },
  )
})

describe("thread_read wait_ms on another device's relay watch (#13417)", () => {
  test("#given b's thread is running #when a resync after a relay gap finds it idle #then the read settles", async () => {
    const a = account({ engine: { ...ENGINE, streaming: true } })
    const { run } = surface(a.remote)
    const reading = run("thread_read", { thread: "dur-on-b", wait_ms: 60_000 })
    await a.watching
    for (const handlers of [...a.watchers]) {
      handlers.lost?.("closed")
      handlers.resynced?.({
        from: "running",
        state: { status: "idle", sessionId: "rk-on-b" },
        settledTurns: ["7"],
        restarted: false,
      })
    }
    expect(await reading).toMatchObject({ kind: "ok", wait: { outcome: "settled", status: "idle" } })
  })

  test("#given b's watch is refused #when thread_read waits #then the refusal is typed with the device, and no transcript is read", async () => {
    const a = account({ refuse: "capability_missing" })
    const { run } = surface(a.remote)
    expect(await run("thread_read", { thread: "dur-on-b", wait_ms: 1_000 })).toMatchObject({
      kind: "error",
      error: { details: { device: "b" } },
    })
  })

  test("#given wait_ms past the cap #when thread_read runs #then it is invalid_arguments and nothing is sent", async () => {
    const a = account()
    const { run } = surface(a.remote)
    expect(await run("thread_read", { thread: "dur-on-b", wait_ms: 600_001 })).toMatchObject({
      kind: "error",
      error: { code: "invalid_arguments" },
    })
    expect(a.sent).toEqual([])
  })
})
