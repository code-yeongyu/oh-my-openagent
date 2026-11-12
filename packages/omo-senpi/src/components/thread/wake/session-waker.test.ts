import { afterEach, describe, expect, test } from "bun:test"
import { join } from "node:path"

import { createGatewayHarness, type GatewayHarness } from "../gateway/testing/harness"
import { createLegacyWakeOpen } from "./legacy-open"
import { createSessionWaker, type WakeOutcome } from "./session-waker"
import { startFakeWakeHost, writeSessionFile, type FakeWakeHost, type WakeHostReply } from "./testing/fake-wake-host"

// The wake primitive, steps 1 to 5 (#13037 design 5.2, amendment A3.3): resolve, refuse a child, take a place in the
// store, ensure the host, send one plain `open_session` frame. Driven end to end over a real store and a socket host.

let harness: GatewayHarness | undefined
let host: FakeWakeHost | undefined
afterEach(async () => {
  await host?.close()
  host = undefined
  await harness?.dispose()
  harness = undefined
})

const OPENED: WakeHostReply = {
  success: true,
  data: { sessionId: "rpc-7", attached: false, state: { sessionId: "rpc-7", lifecycle: { state: "done" } } },
}

function refusal(code: string, errorData?: Record<string, unknown>): WakeHostReply {
  return { success: false, error: code, errorCode: code, ...(errorData === undefined ? {} : { errorData }) }
}

async function setup(respond: (frame: Readonly<Record<string, unknown>>, index: number) => WakeHostReply) {
  const h = (harness = createGatewayHarness())
  const fake = (host = await startFakeWakeHost(respond))
  const store = h.store()
  const sessions = join(h.agentDir, "sessions")
  const ensured: number[] = []
  const waker = createSessionWaker({
    store,
    sessionsDirectory: sessions,
    ensureHost: async () => {
      ensured.push(fake.frames.length)
    },
    open: createLegacyWakeOpen({ env: { SENPI_RPC_SOCKET: fake.socketPath }, keyRoot: () => h.agentDir }),
  })
  return { h, fake, store, sessions, ensured, waker }
}

describe("ensureSessionRunning", () => {
  test("#given a session that ended cleanly #when it is woken #then one plain open_session frame is sent after the host is ensured and the row is left opening", async () => {
    const { fake, store, sessions, ensured, waker } = await setup(() => OPENED)
    const path = writeSessionFile(sessions, "s1", { cwd: "/work/where-it-ran" })

    const outcome = await waker.ensureSessionRunning("s1")

    expect(outcome).toEqual({
      kind: "live",
      session_id: "rpc-7",
      state: { sessionId: "rpc-7", lifecycle: { state: "done" } },
      generation: 1,
    })
    expect(ensured).toEqual([0])
    expect(fake.frames).toHaveLength(1)
    const [frame] = fake.frames
    expect(Object.keys(frame ?? {}).sort()).toEqual(["cwd", "id", "retain_on_disconnect", "sessionPath", "type"])
    expect(frame).toMatchObject({
      type: "open_session",
      sessionPath: path,
      cwd: "/work/where-it-ran",
      retain_on_disconnect: true,
    })
    expect(await store.woken.list()).toMatchObject([{ durable_id: "s1", state: "opening", generation: 1 }])
  })

  test("#given two calls for one session at once #when both run #then the host receives one open and both answer live", async () => {
    const { fake, sessions, waker } = await setup(() => OPENED)
    writeSessionFile(sessions, "s1")
    const answers = await Promise.all([waker.ensureSessionRunning("s1"), waker.ensureSessionRunning("s1")])
    expect(answers.map((answer) => answer.kind)).toEqual(["live", "live"])
    expect(fake.frames).toHaveLength(1)
  })

  test("#given no session file for the id #when it is woken #then it is gone, nothing is opened and no row is written", async () => {
    const { fake, store, ensured, waker } = await setup(() => OPENED)
    expect(await waker.ensureSessionRunning("missing")).toEqual({ kind: "gone" })
    expect(fake.frames).toEqual([])
    expect(ensured).toEqual([])
    expect(await store.woken.list()).toEqual([])
  })

  test("#given two session files carrying one id #when it is woken #then it is ambiguous and nothing is opened", async () => {
    const { fake, store, sessions, waker } = await setup(() => OPENED)
    const first = writeSessionFile(sessions, "s1", {}, "--tmp-one--")
    const second = writeSessionFile(sessions, "s1", {}, "--tmp-two--")
    const outcome = await waker.ensureSessionRunning("s1")
    expect(outcome.kind).toBe("ambiguous")
    if (outcome.kind !== "ambiguous") throw new Error("not ambiguous")
    expect([...outcome.session_paths].sort()).toEqual([first, second].sort())
    expect(fake.frames).toEqual([])
    expect(await store.woken.list()).toEqual([])
  })

  test.each<[string, Record<string, unknown>, "child" | "worker"]>([
    ["a child session", { spawnedBy: { parentSessionId: "p", rootSessionId: "p", taskId: "t1" } }, "child"],
    ["a worker session", { kind: "worker" }, "worker"],
  ])(
    "#given %s #when it is woken #then it is not wakeable, nothing is opened and no row is left",
    async (_label, header, sessionKind) => {
      const { fake, store, sessions, ensured, waker } = await setup(() => OPENED)
      writeSessionFile(sessions, "s1", header)
      expect(await waker.ensureSessionRunning("s1")).toEqual({ kind: "not_wakeable", session_kind: sessionKind })
      expect(fake.frames).toEqual([])
      expect(ensured).toEqual([])
      expect(await store.woken.list()).toEqual([])
    },
  )

  test("#given four woken sessions past requested #when a fifth is woken #then it is overloaded, nothing is opened and its row stays requested", async () => {
    const { fake, store, sessions, ensured, waker } = await setup(() => OPENED)
    for (const id of ["a", "b", "c", "d"]) {
      await store.woken.request({ durable_id: id, session_file: `/sessions/${id}.jsonl` })
      await store.woken.start({ durable_id: id })
    }
    writeSessionFile(sessions, "s1")
    expect(await waker.ensureSessionRunning("s1")).toEqual({ kind: "overloaded" })
    expect(fake.frames).toEqual([])
    expect(ensured).toEqual([])
    expect((await store.woken.list()).find((row) => row.durable_id === "s1")?.state).toBe("requested")
  })

  test.each<[string, WakeHostReply, WakeOutcome]>([
    ["session_held", refusal("session_held", { holders: [{ pid: 4242 }] }), { kind: "busy", code: "session_held" }],
    [
      "session_path_in_use",
      refusal("session_path_in_use", { owner: { pid: 4242, current: true }, retry_after_ms: 2000 }),
      { kind: "busy", code: "session_path_in_use", retry_after_ms: 2000 },
    ],
    ["invalid_path", refusal("invalid_path"), { kind: "gone" }],
  ])(
    "#given the host refuses the open with %s #when it is woken #then the answer is typed, the open is not retried and the row is ended",
    async (_code, reply, expected) => {
      const { fake, store, sessions, waker } = await setup(() => reply)
      writeSessionFile(sessions, "s1")
      expect(await waker.ensureSessionRunning("s1")).toEqual(expected)
      expect(fake.frames).toHaveLength(1)
      expect(await store.woken.list()).toEqual([])
    },
  )

  test("#given a transient failure #when it is woken #then the open is not retried in a loop and the row goes back to requested with one attempt and a next-attempt time", async () => {
    const { h, fake, store, sessions, waker } = await setup(() => refusal("host_stopping"))
    writeSessionFile(sessions, "s1")
    const outcome = await waker.ensureSessionRunning("s1")
    expect(outcome).toMatchObject({ kind: "deferred", attempts: 1 })
    expect(fake.frames).toHaveLength(1)
    const [row] = await store.woken.list()
    expect(row).toMatchObject({ durable_id: "s1", state: "requested", attempts: 1, lease_owner: null })
    expect(row?.next_attempt_at).toBeGreaterThan(h.clock.now)
    if (outcome.kind === "deferred") expect(outcome.next_attempt_at).toBe(row?.next_attempt_at ?? -1)
  })

  test("#given a deferred wake #when it is woken again before the next-attempt time #then nothing is opened and the answer names that time", async () => {
    const { fake, store, sessions, ensured, waker } = await setup(() => refusal("host_stopping"))
    writeSessionFile(sessions, "s1")
    await waker.ensureSessionRunning("s1")
    const [row] = await store.woken.list()
    expect(await waker.ensureSessionRunning("s1")).toEqual({ kind: "not_yet", next_attempt_at: row?.next_attempt_at ?? -1 })
    expect(fake.frames).toHaveLength(1)
    expect(ensured).toHaveLength(1)
  })

  test("#given a host that keeps failing for a transient reason #when it is woken at each next-attempt time #then the third failure deletes the row and answers failed", async () => {
    const { h, fake, store, sessions, waker } = await setup(() => refusal("host_stopping"))
    writeSessionFile(sessions, "s1")
    const kinds: string[] = []
    for (let attempt = 0; attempt < 3; attempt++) {
      const outcome = await waker.ensureSessionRunning("s1")
      kinds.push(outcome.kind)
      if (outcome.kind === "deferred") h.clock.now = outcome.next_attempt_at
    }
    expect(kinds).toEqual(["deferred", "deferred", "failed"])
    expect(fake.frames).toHaveLength(3)
    expect(await store.woken.list()).toEqual([])
  })

  test("#given a host that fails twice then opens #when it is woken at each next-attempt time #then the third call answers live and the row is opening", async () => {
    const { h, fake, store, sessions, waker } = await setup((_frame, index) =>
      index < 2 ? refusal("host_stopping") : OPENED,
    )
    writeSessionFile(sessions, "s1")
    for (let attempt = 0; attempt < 2; attempt++) {
      const outcome = await waker.ensureSessionRunning("s1")
      if (outcome.kind !== "deferred") throw new Error(`expected deferred, got ${outcome.kind}`)
      h.clock.now = outcome.next_attempt_at
    }
    expect(await waker.ensureSessionRunning("s1")).toMatchObject({ kind: "live" })
    expect(fake.frames).toHaveLength(3)
    expect(await store.woken.list()).toMatchObject([{ durable_id: "s1", state: "opening", attempts: 2 }])
  })

  test("#given another carrier already started the row #when it is woken here #then it is busy and the other carrier's row is untouched", async () => {
    const { h, fake, store, sessions, waker } = await setup(() => OPENED)
    writeSessionFile(sessions, "s1")
    const other = h.store()
    await other.woken.request({ durable_id: "s1", session_file: "/sessions/s1.jsonl" })
    await other.woken.start({ durable_id: "s1" })

    expect(await waker.ensureSessionRunning("s1")).toEqual({ kind: "busy", code: "wake_in_progress" })
    expect(fake.frames).toEqual([])
    expect(await store.woken.list()).toMatchObject([
      { durable_id: "s1", state: "opening", generation: 1, lease_owner: await other.identity() },
    ])
  })
})
