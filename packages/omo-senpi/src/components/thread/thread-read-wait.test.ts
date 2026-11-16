import { afterEach, describe, expect, test } from "bun:test"
import { createRemoteThreadFixture, ENGINE } from "./thread-remote-fixture"

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

// #13417: thread_read wait_ms waits, bounded, for a thread on another device to stop running, on the watch's events.
describe("thread_read wait_ms (#13417)", () => {
  test("#given b's thread is idle #when thread_read waits #then it settles at once with idle and returns the transcript", async () => {
    const a = account({ engine: { ...ENGINE, streaming: false } })
    const { run } = surface(a.remote)
    const read = await run("thread_read", { thread: "dur-on-b", wait_ms: 60_000 })
    expect(read).toMatchObject({
      kind: "ok",
      thread_id: "dur-on-b",
      device: "b",
      wait: { outcome: "settled", status: "idle" },
    })
    expect(a.watchers.size).toBe(0)
  })

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
