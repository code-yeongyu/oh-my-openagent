import { afterEach, describe, expect, test } from "bun:test"
import type { RemoteThreadSurface } from "./remote/ports"
import type { ThreadToolName, ThreadToolResult } from "./contracts"
import { createRemoteThreadFixture } from "./thread-remote-fixture"

// #13426: a thread tool call takes the host's abort signal. Cancelling the call settles it at once, typed `cancelled`,
// even while a command to another device is still waiting for an answer that never comes.

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

/** b's device takes every session command and never answers; `sent` settles when the first one leaves this device. */
function silentDevice(remote: RemoteThreadSurface): {
  readonly remote: RemoteThreadSurface
  readonly sent: Promise<void>
} {
  let reached = () => {}
  const sent = new Promise<void>((resolve) => {
    reached = resolve
  })
  const sessions = {
    ...remote.sessions,
    sessionCommand: (() => {
      reached()
      return new Promise<never>(() => {})
    }) as RemoteThreadSurface["sessions"]["sessionCommand"],
  }
  return { remote: { ...remote, sessions }, sent }
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
})
