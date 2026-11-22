import { afterEach, describe, expect, test } from "bun:test"
import type { RemoteThreadSurface } from "./remote/ports"
import type { ThreadToolName, ThreadToolResult } from "./contracts"
import { THREAD_ERROR_CODES } from "./errors"
import { createRemoteThreadFixture } from "./thread-remote-fixture"

// #13426: a thread tool call takes the host's abort signal. Cancelling the call settles it at once, typed `cancelled`,
// even while a command to another device is still waiting for an answer that never comes.

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

/** b's device takes every session command and never answers; `sent` settles when the first one leaves this device. */
function silentDevice(remote: RemoteThreadSurface): {
  readonly remote: RemoteThreadSurface
  readonly sent: Promise<void>
  readonly commands: () => number
} {
  let count = 0
  let reached = () => {}
  const sent = new Promise<void>((resolve) => {
    reached = resolve
  })
  const sessions = {
    ...remote.sessions,
    sessionCommand: (() => {
      count += 1
      reached()
      return new Promise<never>(() => {})
    }) as RemoteThreadSurface["sessions"]["sessionCommand"],
  }
  return { remote: { ...remote, sessions }, sent, commands: () => count }
}

/** The call's answer, or a failure naming what never settled: a circuit breaker, never a wait the assertion relies on. */
async function settlesWithin(call: Promise<ThreadToolResult>, what: string, ms = 2_000): Promise<ThreadToolResult> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const breaker = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not settle within ${ms} ms of the abort`)), ms)
  })
  try {
    return await Promise.race([call, breaker])
  } finally {
    clearTimeout(timer)
  }
}

describe("#13426: a cancelled thread tool call stops waiting", () => {
  test.each<[ThreadToolName, Record<string, unknown>]>([
    ["thread_read", { thread: "dur-on-b" }],
    ["thread_interrupt", { thread: "dur-on-b" }],
    ["thread_send", { thread: "dur-on-b", message: "status?" }],
  ])(
    "#given %s on a thread whose device never answers #when the caller aborts mid-call #then it settles cancelled at once",
    async (name, args) => {
      const { remote, sent } = silentDevice(account().remote)
      const { run } = surface(remote)
      const controller = new AbortController()
      const call = run(name, args, controller.signal)
      await sent
      controller.abort()
      expect(await settlesWithin(call, name)).toMatchObject({ kind: "error", error: { code: "cancelled" } })
    },
  )

  test("#given a call its caller already cancelled #when it runs #then nothing is sent and it answers cancelled", async () => {
    const a = account()
    const { run } = surface(a.remote)
    const controller = new AbortController()
    controller.abort()
    expect(await run("thread_send", { thread: "dur-on-b", message: "status?" }, controller.signal)).toMatchObject({
      kind: "error",
      error: { code: "cancelled" },
    })
    expect(a.sent).toEqual([])
  })

  test("#given a call cancelled while it still builds its view #when the same key runs again #then nothing ran: it runs fresh, not uncertain", async () => {
    const a = account()
    let listed = () => {}
    const listing = new Promise<void>((resolve) => {
      listed = resolve
    })
    let open = () => {}
    const listingGate = new Promise<void>((resolve) => {
      open = resolve
    })
    const { run } = surface(a.remote, { onListing: () => listed(), listingGate })
    const controller = new AbortController()
    const call = run("thread_interrupt", { thread: "dur-on-b", idempotency_key: "k-view" }, controller.signal)
    await listing
    controller.abort()
    expect(await settlesWithin(call, "thread_interrupt")).toMatchObject({
      kind: "error",
      error: { code: "cancelled", message: expect.stringContaining("nothing ran") },
    })
    open()
    // Nothing left this device, so the receipt was dropped: the retry runs instead of answering idempotency_*.
    const retry = await run("thread_interrupt", { thread: "dur-on-b", idempotency_key: "k-view" })
    expect(retry).not.toMatchObject({ kind: "error", error: { code: expect.stringMatching(/^idempotency_/) } })
    expect(a.sent.length).toBeGreaterThan(0)
  })

  test("#given a call cancelled after its command left this device #when the same key runs again #then it is not sent twice and answers what happened, uncertain", async () => {
    const { remote, sent, commands } = silentDevice(account().remote)
    const { run } = surface(remote)
    const controller = new AbortController()
    const call = run("thread_interrupt", { thread: "dur-on-b", idempotency_key: "k-sent" }, controller.signal)
    await sent
    controller.abort()
    expect(await settlesWithin(call, "thread_interrupt")).toMatchObject({
      kind: "error",
      error: { code: "cancelled", message: expect.stringContaining("may have reached") },
    })
    // The transport released its hold, so the run settles and records itself; until then the key is held (in progress).
    let retry = await run("thread_interrupt", { thread: "dur-on-b", idempotency_key: "k-sent" })
    for (let turn = 0; turn < 200 && JSON.stringify(retry).includes("idempotency_in_progress"); turn += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve))
      retry = await run("thread_interrupt", { thread: "dur-on-b", idempotency_key: "k-sent" })
    }
    expect(JSON.stringify(retry)).not.toContain("idempotency_in_progress")
    expect(retry).toMatchObject({ kind: "error" })
    expect(JSON.stringify(retry)).toMatch(/uncertain|cancelled/)
    expect(commands()).toBe(1)
  })

  test("#given a command whose device never answers #when its call is cancelled #then the transport hold is released and the run records its own outcome", async () => {
    const { remote, sent, commands } = silentDevice(account().remote)
    const { run } = surface(remote)
    const controller = new AbortController()
    const call = run("thread_read", { thread: "dur-on-b", idempotency_key: "k-read" }, controller.signal)
    await sent
    controller.abort()
    await settlesWithin(call, "thread_read")
    // A held transport never lets the run settle: its key would stay in progress (or be marked uncertain by hand).
    // Released, the run settles and records what it did, which a same-key retry replays.
    let retry = await run("thread_read", { thread: "dur-on-b", idempotency_key: "k-read" })
    for (let turn = 0; turn < 200 && JSON.stringify(retry).includes("idempotency_in_progress"); turn += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve))
      retry = await run("thread_read", { thread: "dur-on-b", idempotency_key: "k-read" })
    }
    expect(JSON.stringify(retry)).not.toContain("idempotency_in_progress")
    // The run's own outcome (the read's command to b ended uncertain because it was cancelled), not a note the
    // cancellation wrote over the receipt by hand.
    expect(retry).toMatchObject({ kind: "error", error: { details: { device: "b", reason: "cancelled" } } })
    expect(JSON.stringify(retry)).not.toContain("error_note")
    expect(commands()).toBe(1)
  })

  test("#given the thread error taxonomy #then every code is listed once", () => {
    expect(new Set(THREAD_ERROR_CODES).size).toBe(THREAD_ERROR_CODES.length)
    expect(THREAD_ERROR_CODES.filter((code) => code === "cancelled")).toHaveLength(1)
  })
})
