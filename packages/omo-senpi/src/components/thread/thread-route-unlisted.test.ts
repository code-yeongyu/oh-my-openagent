import { afterEach, describe, expect, test } from "bun:test"
import { createRemoteThreadFixture } from "./thread-remote-fixture"

// omo#14233: a device service refuses a session command `route_unlisted` when its host does not list that session
// right now (relay-spec decision 0018 section 5): the session parked after this device listed it. Nothing was
// dispatched and no omo update changes that, so each command answers as for a session the device no longer runs.

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

describe("a session command refused route_unlisted by the device holding the thread", () => {
  test("#given b's host no longer lists the thread's session #when thread_close names it #then it answers closed false, not_live, naming b", async () => {
    const a = account({ refuse: "route_unlisted" })
    const { run } = surface(a.remote)
    expect(await run("thread_close", { thread: "dur-on-b" })).toEqual({
      kind: "ok",
      thread: "dur-on-b",
      closed: false,
      reason: "not_live",
      dropped_deliveries: [],
      device: "b",
    })
    expect(a.sent.map((entry) => entry.rpc?.["type"])).toEqual(["unload_session"])
  })

  // A send re-asks b whether it still runs the thread (find_session, #14240); b refusing that too answers nothing, so the
  // send cannot say the thread stopped (#15004): a host to retry.
  test.each([
    ["thread_read", { thread: "dur-on-b" }, "not_resumable"],
    ["thread_rename", { thread: "dur-on-b", name: "renamed" }, "not_resumable"],
    ["thread_interrupt", { thread: "dur-on-b" }, "not_resumable"],
    ["thread_send", { thread: "dur-on-b", message: "hello" }, "host_unavailable"],
  ] as const)(
    "#given b's host no longer lists the thread's session #when %s names it #then it is %s naming b and route_unlisted, never an update-omo answer",
    async (tool, input, code) => {
      const a = account({ refuse: "route_unlisted" })
      const { run } = surface(a.remote)
      const result = await run(tool, input)
      expect(result).toMatchObject({
        kind: "error",
        error: { code, details: { device: "b", reason: "route_unlisted" } },
      })
      expect(JSON.stringify(result)).not.toContain("Update omo")
    },
  )

  // #14240 re-asks b with find_session after a live-listed thread's send is refused route_unlisted. When b's engine
  // predates find_session, nothing new was learnt: the send answers the route_unlisted refusal it already had, even where
  // this device could wake the thread. #15004: when b does not answer it at all (no answer in time, or no route to the
  // engine it named), nothing proves the thread stopped: b is too busy to route it, a host to retry, never "not running".
  test.each([
    ["unsupported", "not_resumable"],
    ["method_unclassified", "not_resumable"],
    ["route_unlisted", "host_unavailable"],
    ["request_timeout", "host_unavailable"],
  ] as const)(
    "#given b's host no longer lists the thread's session and b's find_session is refused %s #when thread_send names it #then it is %s naming b and route_unlisted, and nothing is woken (#14240, #15004)",
    async (findSessionRefuse, code) => {
      const a = account({
        live: [],
        unlistedReason: "route_unlisted",
        sessionFiles: "none",
        findSessionRefuse,
        wakeFeature: true,
      })
      const { run } = surface(a.remote)
      const result = await run("thread_send", { thread: "dur-on-b", message: "hello" })
      expect(result).toMatchObject({
        kind: "error",
        error: { code, details: { device: "b", reason: "route_unlisted" } },
      })
      expect(JSON.stringify(result)).not.toContain("Update omo")
      expect(a.sent.filter((entry) => entry.rpc?.["type"] === "find_session")).toHaveLength(1)
      expect(a.sent.filter((entry) => entry.via === "wake")).toEqual([])
    },
  )

  // #15004: a starved host refuses route_unlisted for a session its engine still runs: find_session says an engine holds
  // it open, yet no key routes to it now. Nothing proves it stopped and nothing was dispatched: a busy host to retry.
  test("#given b's engine holds the thread open but b's host routes neither the send nor the locate #when thread_send names it #then it is host_unavailable naming b and route_unlisted, not not_resumable (#15004)", async () => {
    const a = account({ refuseSessionCommands: "route_unlisted", locateRefuse: "route_unlisted" })
    const { run } = surface(a.remote)
    expect(await run("thread_send", { thread: "dur-on-b", message: "hello" })).toMatchObject({
      kind: "error",
      error: { code: "host_unavailable", details: { device: "b", reason: "route_unlisted" } },
    })
  })

  // #15004: a send b refused before any engine took it (its host did not route it, or did not answer in its bound) holds
  // no key: the retry it advises is a fresh send under that key, with or without its optional fields, and delivers once.
  test.each([
    ["its host did not answer in time", { admitRefuse: "host_not_answering" }],
    [
      "its host routed no key to the running thread",
      { refuseSessionCommands: "route_unlisted", locateRefuse: "route_unlisted" },
    ],
  ] as const)(
    "#given b refused a send because %s #when b answers again and the send is retried under the same key without its summary #then the retry delivers it once",
    async (_label, refusal) => {
      const options: { admitRefuse?: string; refuseSessionCommands?: string; locateRefuse?: string } = { ...refusal }
      const a = account(options)
      const { run } = surface(a.remote)
      const args = { thread: "dur-on-b", message: "hello", idempotency_key: "busy-retry" }

      expect(await run("thread_send", { ...args, summary: "greeting" })).toMatchObject({
        kind: "error",
        error: { code: "host_unavailable" },
      })
      delete options.admitRefuse
      delete options.refuseSessionCommands
      delete options.locateRefuse

      expect(await run("thread_send", args)).toMatchObject({ kind: "ok", deduplicated: false })
      expect(
        a.sent.filter((entry) => entry.rpc?.["type"] === "admit_external_message" && entry.via === "session"),
      ).toHaveLength("admitRefuse" in refusal ? 2 : 1)
    },
  )

  test("#given b's host lists no engine endpoint for the create, even on a fresh lookup #when thread_create opens on b #then it is host_unavailable naming b and route_unlisted, nothing opened, never an update-omo answer", async () => {
    const a = account({ openRefuse: "route_unlisted" })
    const { run } = surface(a.remote)
    const result = await run("thread_create", { device: "b", name: "fresh" })
    expect(result).toMatchObject({
      kind: "error",
      error: { code: "host_unavailable", details: { device: "b", reason: "route_unlisted" } },
    })
    expect(JSON.stringify(result)).not.toContain("Update omo")
  })

  test("#given b's closed thread and an engine endpoint b no longer lists for the file lookup #when thread_create reopens it #then it is host_unavailable naming b and route_unlisted, not not_resumable (#14237 review L1)", async () => {
    const a = account({ rowState: "ended", sessionFiles: "none", findSessionRefuse: "route_unlisted" })
    const { run } = surface(a.remote)
    const result = await run("thread_create", { thread: "dur-on-b" })
    expect(result).toMatchObject({
      kind: "error",
      error: { code: "host_unavailable", details: { device: "b", reason: "route_unlisted" } },
    })
    expect(a.sent.map((entry) => entry.rpc?.["type"])).not.toContain("open_session")
  })
})
