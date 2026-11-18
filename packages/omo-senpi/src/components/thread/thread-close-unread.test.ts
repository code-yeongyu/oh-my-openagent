import { afterEach, describe, expect, test } from "bun:test"
import { createRemoteThreadFixture } from "./thread-remote-fixture"

// omo#14234 (LEAD ruling): a close never drops a message the thread has not read unless the caller asked for it. The
// default close refuses a busy thread with unread deliveries, naming them, and stops nothing; `force: true` closes it and
// lists what it dropped; an idle thread's stranded deliveries (#14169) are still handed back, listed; an engine that
// cannot refuse (no `unload_refuse_deliveries`) is never sent an interrupt by a default close.

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

const UNREAD = ["device:a/second", "device:a/third"]
const unloads = (a: ReturnType<typeof account>) =>
  a.sent.filter((entry) => entry.rpc?.["type"] === "unload_session").map((entry) => entry.rpc)
const interrupted = (a: ReturnType<typeof account>) => unloads(a).filter((rpc) => rpc?.["interrupt"] === true)

describe("thread_close and the messages a thread has not read (#14234)", () => {
  test("#given b's thread is busy with two unread deliveries #when thread_close names it #then it is refused turn_active naming them and the force option, and the thread keeps running with both", async () => {
    const a = account({ busy: true, unread: UNREAD })
    const { run } = surface(a.remote)
    expect(await run("thread_close", { thread: "dur-on-b" })).toMatchObject({
      kind: "error",
      error: {
        code: "turn_active",
        details: { device: "b", reason: "work_pending", pending_deliveries: UNREAD, retry_with: { force: true } },
      },
    })
    expect(a.live.has("rk-on-b")).toBe(true)
    expect(unloads(a).every((rpc) => rpc?.["deliveries"] === "refuse")).toBe(true)
  })

  test("#given the same thread #when thread_close passes force #then it closes and the result lists the dropped deliveries", async () => {
    const a = account({ busy: true, unread: UNREAD })
    const { run } = surface(a.remote)
    expect(await run("thread_close", { thread: "dur-on-b", force: true })).toEqual({
      kind: "ok",
      thread: "dur-on-b",
      device: "b",
      closed: true,
      reason: "closed",
      dropped_deliveries: UNREAD,
    })
    expect(a.live.has("rk-on-b")).toBe(false)
  })

  test("#given b's thread is idle after an interrupted run with a stranded delivery #when thread_close names it without force #then it closes and lists the delivery it handed back (#14169)", async () => {
    const a = account({ unread: ["device:a/stranded"] })
    const { run } = surface(a.remote)
    expect(await run("thread_close", { thread: "dur-on-b" })).toEqual({
      kind: "ok",
      thread: "dur-on-b",
      device: "b",
      closed: true,
      reason: "closed",
      dropped_deliveries: ["device:a/stranded"],
    })
  })

  test("#given b's thread is busy with nothing unread #when thread_close names it #then its run is stopped and it closes with nothing dropped", async () => {
    const a = account({ busy: true })
    const { run } = surface(a.remote)
    expect(await run("thread_close", { thread: "dur-on-b" })).toMatchObject({
      kind: "ok",
      closed: true,
      dropped_deliveries: [],
    })
    expect(a.sent.map((entry) => entry.rpc?.["type"])).toEqual([
      "unload_session",
      "get_protocol_info",
      "unload_session",
    ])
  })

  test("#given an idle thread on b with nothing pending #when thread_close names it #then one unload closes it", async () => {
    const a = account()
    const { run } = surface(a.remote)
    expect(await run("thread_close", { thread: "dur-on-b" })).toMatchObject({
      kind: "ok",
      closed: true,
      dropped_deliveries: [],
    })
    expect(a.sent.map((entry) => entry.rpc?.["type"])).toEqual(["unload_session"])
  })

  test("#given an engine that names the unread deliveries on a turn_active refusal #when thread_close names the thread #then the answer is the same as for work_pending (#14242 review L2)", async () => {
    const a = account({ busy: true, unread: UNREAD, unreadReason: "turn_active" })
    const { run } = surface(a.remote)
    expect(await run("thread_close", { thread: "dur-on-b" })).toMatchObject({
      kind: "error",
      error: {
        code: "turn_active",
        // omo#14245: the engine's own reason, not a fixed one.
        details: { reason: "turn_active", pending_deliveries: UNREAD, retry_with: { force: true } },
      },
    })
    expect(a.live.has("rk-on-b")).toBe(true)
  })

  test.each([
    ["an engine that ignores deliveries", { refusesDeliveries: false }],
    // Busy with nothing it names: only the capability read could allow an interrupt, and it never answers.
    ["an engine whose capability read times out", { protocolInfoFails: true, unread: [] }],
  ] as const)(
    "#given %s and a busy thread #when thread_close names it without force #then nothing is interrupted and the refusal says the ids are unavailable",
    async (_label, engine) => {
      const a = account({ busy: true, unread: UNREAD, ...engine })
      const { run } = surface(a.remote)
      expect(await run("thread_close", { thread: "dur-on-b" })).toMatchObject({
        kind: "error",
        error: { code: "turn_active", details: { device: "b", pending_deliveries: "unavailable" } },
      })
      expect(interrupted(a)).toEqual([])
      expect(a.live.has("rk-on-b")).toBe(true)
    },
  )
})
