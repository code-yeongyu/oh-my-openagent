import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import type { DeviceService } from "@oh-my-opencode/device-service-core/device-service"
import { closingPorts } from "./remote/testing/closing-ports"
import type { RemoteThreadSurface } from "./remote/ports"
import type { ThreadToolName, ThreadToolResult } from "./contracts"
import { THREAD_ERROR_CODES } from "./errors"
import { createRemoteThreadFixture } from "./thread-remote-fixture"

// #13426: a thread tool call takes the host's abort signal. Cancelling the call settles it at once, typed `cancelled`,
// even while a command to another device is still waiting for an answer that never comes.

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)
const sessionsPort = closingPorts()

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
      error: { code: "cancelled", message: "The call was cancelled before it started; nothing ran." },
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

  test("abort during the model catalog prevents set_model and leaves the key reusable", async () => {
    const { host, run } = surface(undefined)
    const controller = new AbortController()
    const models = [{ provider: "openai", id: "choice" }]
    spyOn(host, "getAvailableModels")
      .mockImplementationOnce(async () => {
        controller.abort()
        return models
      })
      .mockResolvedValue(models)
    const selected = spyOn(host, "setModel")
    const args = { thread: "dur-local", model: "openai/choice", idempotency_key: "catalog" }
    const answer = await run("thread_set_model", args, controller.signal)
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(selected).not.toHaveBeenCalled()
    expect(answer).toMatchObject({
      error: { code: "cancelled", message: "The call was cancelled before it started; nothing ran." },
    })
    expect(await run("thread_set_model", args)).toMatchObject({ kind: "ok" })
    expect(selected).toHaveBeenCalledTimes(1)
  })

  test("abort during create's name check prevents the remote open", async () => {
    const { remote, sent } = account()
    const controller = new AbortController()
    const list = remote.sessions.sessions
    const sessions = {
      ...remote.sessions,
      sessions: async (...args: Parameters<typeof list>) => {
        const rows = await list(...args)
        controller.abort()
        return rows
      },
    }
    const { run } = surface({ ...remote, sessions })
    const answer = await run("thread_create", { device: "studio", name: "before-open" }, controller.signal)
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(sent.map((entry) => entry.rpc?.type)).not.toContain("open_session")
    expect(answer).toMatchObject({
      error: { code: "cancelled", message: "The call was cancelled before it started; nothing ran." },
    })
  })

  test("abort after remote open keeps its connection and receipt until the real reply", async () => {
    const { remote } = account()
    const sent = Promise.withResolvers<void>()
    const reply = Promise.withResolvers<void>()
    const close = mock(() => {})
    const open = mock(async (device: string, rpc: Parameters<typeof remote.sessions.endpointCommand>[1]) => {
      sent.resolve()
      await reply.promise
      const opened = await remote.sessions.endpointCommand(device, rpc)
      if (opened.kind !== "ok") throw new Error(opened.reason)
      return { endpoint: "host", outcome: { state: "engine_applied" }, response: opened.response }
    })
    const conn = { endpointCommand: open, close } as unknown as DeviceService
    const port = sessionsPort({ version: "test", dialEndpoint: async () => ({ conn, owned: true }) })
    const { run, store } = surface({
      ...remote,
      sessions: { ...remote.sessions, endpointCommand: port.endpointCommand },
    })
    const done = Promise.withResolvers<void>()
    const settle = store.toolReceiptSettle.bind(store)
    spyOn(store, "toolReceiptSettle").mockImplementation(async (req) => {
      const result = await settle(req)
      done.resolve()
      return result
    })
    const args = { device: "studio", name: "owned-open", idempotency_key: "open" }
    const controller = new AbortController()
    const call = run("thread_create", args, controller.signal)
    await sent.promise
    controller.abort()
    try {
      expect(await settlesWithin(call, "thread_create")).toMatchObject({ error: { code: "cancelled" } })
      expect(await run("thread_create", args)).toMatchObject({ error: { code: "idempotency_in_progress" } })
      expect(close).not.toHaveBeenCalled()
    } finally {
      reply.resolve()
    }
    await done.promise
    expect(close).toHaveBeenCalledTimes(1)
    expect(await run("thread_create", args)).toMatchObject({ kind: "ok", thread: "dur-new-on-b", name: "owned-open" })
    expect(open).toHaveBeenCalledTimes(1)
  })

  test.each([
    { abort: false, scenario: "conflicting arguments do not consume admission recovery" },
    { abort: true, scenario: "abort during failed admission answers cancelled and preserves recovery" },
  ])("$scenario", async ({ abort }) => {
    const { run, store, setSessionName } = surface(undefined)
    const controller = new AbortController()
    const begin = store.toolReceiptBegin.bind(store)
    spyOn(store, "toolReceiptBegin").mockImplementationOnce(async (req) => {
      await begin(req)
      if (abort) controller.abort()
      throw new Error("lost admission reply after commit")
    })
    const args = { thread: "dur-local", name: "original", idempotency_key: "recover" }
    expect(await run("thread_rename", args, controller.signal)).toMatchObject({
      error: { code: abort ? "cancelled" : "internal_error" },
    })
    expect(await run("thread_rename", { ...args, name: "other" })).toMatchObject({
      error: { code: "idempotency_conflict" },
    })
    expect(setSessionName).not.toHaveBeenCalled()
    const recovered = await run("thread_rename", args)
    expect(recovered).toMatchObject({ kind: "ok", name: "original" })
    expect(await run("thread_rename", args)).toEqual(recovered)
    expect(setSessionName).toHaveBeenCalledTimes(1)
  })

  test("#given the thread error taxonomy #then every code is listed once", () => {
    expect(new Set(THREAD_ERROR_CODES).size).toBe(THREAD_ERROR_CODES.length)
    expect(THREAD_ERROR_CODES.filter((code) => code === "cancelled")).toHaveLength(1)
  })
})
