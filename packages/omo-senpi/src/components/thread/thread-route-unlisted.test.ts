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

  test.each([
    ["thread_read", { thread: "dur-on-b" }],
    ["thread_rename", { thread: "dur-on-b", name: "renamed" }],
    ["thread_interrupt", { thread: "dur-on-b" }],
    ["thread_send", { thread: "dur-on-b", message: "hello" }],
  ] as const)(
    "#given b's host no longer lists the thread's session #when %s names it #then it is not_resumable naming b and route_unlisted, never an update-omo answer",
    async (tool, input) => {
      const a = account({ refuse: "route_unlisted" })
      const { run } = surface(a.remote)
      const result = await run(tool, input)
      expect(result).toMatchObject({
        kind: "error",
        error: { code: "not_resumable", details: { device: "b", reason: "route_unlisted" } },
      })
      expect(JSON.stringify(result)).not.toContain("Update omo")
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
