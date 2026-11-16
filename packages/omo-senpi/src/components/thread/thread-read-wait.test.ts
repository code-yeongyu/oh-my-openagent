import { afterEach, describe, expect, test } from "bun:test"
import { createRemoteThreadFixture, ENGINE } from "./thread-remote-fixture"

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

// #13417: thread_read wait_ms waits, bounded, for a thread on another device to stop running, on the watch's events.
describe("thread_read wait_ms (#13417)", () => {
  test("#given b's thread reads idle and shows no run at all #when thread_read waits #then it settles idle only after the quiet window, and returns the transcript", async () => {
    const a = account({ engine: { ...ENGINE, streaming: false } })
    const { run } = surface(a.remote)
    const read = await run("thread_read", { thread: "dur-on-b", wait_ms: 60_000 })
    expect(read).toMatchObject({
      kind: "ok",
      thread_id: "dur-on-b",
      device: "b",
      wait: { outcome: "settled", status: "idle" },
    })
    expect((read as { wait?: { waited_ms: number } }).wait?.waited_ms).toBeGreaterThanOrEqual(2_900)
    expect(a.watchers.size).toBe(0)
  }, 15_000)

  test("#given a send b's snapshot still reads idle for #when the run's records arrive #then the wait settles only at the observed turn end, never on the stale idle", async () => {
    const a = account({ engine: { ...ENGINE, streaming: false } })
    const { run } = surface(a.remote)
    let endEmitted = false
    let settledEarly = false
    const reading = run("thread_read", { thread: "dur-on-b", wait_ms: 60_000 })
    void reading.then(() => {
      settledEarly = !endEmitted
    })
    await a.watching
    for (const handlers of [...a.watchers]) {
      handlers.record({ type: "agent_start", turnId: "7" })
      handlers.status?.({ from: "idle", to: "running", derived: true, cause: "agent_start" })
    }
    endEmitted = true
    for (const handlers of [...a.watchers]) {
      handlers.record({ type: "agent_settled", turnId: "7" })
      handlers.status?.({ from: "running", to: "idle", derived: true, cause: "agent_settled" })
    }
    expect(await reading).toMatchObject({ kind: "ok", wait: { outcome: "settled", status: "idle", turn_id: "7" } })
    expect(settledEarly).toBe(false)
  })

  test("#given a run that started before the wait attached (only its mid-run records arrive) #when the quiet window passes #then the wait keeps waiting and settles at the run's turn end with the baseline status kept", async () => {
    const a = account({ engine: { ...ENGINE, streaming: false } })
    const { run } = surface(a.remote)
    const reading = run("thread_read", { thread: "dur-on-b", wait_ms: 60_000 })
    await a.watching
    for (const handlers of [...a.watchers]) handlers.record({ type: "message_update", turnId: "9" })
    // Time is the behavior here: the end arrives after the 3 s quiet window a run-less session settles on.
    await new Promise<void>((resolve) => setTimeout(resolve, 3_500))
    for (const handlers of [...a.watchers]) handlers.record({ type: "agent_settled", turnId: "9" })
    expect(await reading).toMatchObject({ kind: "ok", wait: { outcome: "settled", status: "idle", turn_id: "9" } })
  }, 15_000)

  test("#given b's idle session writes records that belong to no run (agent_idle, entry_appended) #when thread_read waits #then it still settles idle at the quiet window instead of timing out", async () => {
    const a = account({ engine: { ...ENGINE, streaming: false } })
    const { run } = surface(a.remote)
    const reading = run("thread_read", { thread: "dur-on-b", wait_ms: 8_000 })
    await a.watching
    for (const handlers of [...a.watchers]) {
      handlers.record({ type: "agent_idle" })
      handlers.record({ type: "entry_appended" })
      handlers.record({ type: "thinking_level_changed" })
    }
    expect(await reading).toMatchObject({ kind: "ok", wait: { outcome: "settled", status: "idle" } })
  }, 15_000)

  test("#given b's thread is running #when its status changes to idle during the wait #then the read settles with idle, and the watch is stopped", async () => {
    const a = account({ engine: { ...ENGINE, streaming: true } })
    const { run } = surface(a.remote)
    const reading = run("thread_read", { thread: "dur-on-b", wait_ms: 60_000 })
    await a.watching
    for (const handlers of [...a.watchers]) handlers.status?.({ from: "running", to: "idle", derived: false })
    expect(await reading).toMatchObject({ kind: "ok", wait: { outcome: "settled", status: "idle" } })
    expect(a.watchers.size).toBe(0)
  })

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

  test("#given b's thread keeps running #when wait_ms passes #then the read answers timeout with running and still returns the transcript", async () => {
    const a = account({ engine: { ...ENGINE, streaming: true } })
    const { run } = surface(a.remote)
    const read = await run("thread_read", { thread: "dur-on-b", wait_ms: 1 })
    expect(read).toMatchObject({ kind: "ok", wait: { outcome: "timeout", status: "running" } })
    expect((read as { items?: unknown[] }).items?.length).toBeGreaterThan(0)
  })

  test("#given b's session closes during the wait #when the watch ends session_closed #then the read settles with closed", async () => {
    const a = account({ engine: { ...ENGINE, streaming: true } })
    const { run } = surface(a.remote)
    const reading = run("thread_read", { thread: "dur-on-b", wait_ms: 60_000 })
    await a.watching
    a.endWatches("session_closed")
    expect(await reading).toMatchObject({ kind: "ok", wait: { outcome: "settled", status: "closed" } })
  })

  test("#given b's watch is refused #when thread_read waits #then the refusal is typed with the device, and no transcript is read", async () => {
    const a = account({ refuse: "capability_missing" })
    const { run } = surface(a.remote)
    expect(await run("thread_read", { thread: "dur-on-b", wait_ms: 1_000 })).toMatchObject({
      kind: "error",
      error: { details: { device: "b" } },
    })
  })

  test("#given a thread on this device #when thread_read waits #then it answers unsupported and names the monitor call", async () => {
    const a = account()
    const { run } = surface(a.remote)
    const read = await run("thread_read", { thread: "dur-local", wait_ms: 1_000 })
    expect(read).toMatchObject({ kind: "error", error: { code: "unsupported" } })
    expect((read as { error?: { next_action?: string } }).error?.next_action).toContain(
      'monitor({ type: "rpc", target: "dur-local" })',
    )
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
