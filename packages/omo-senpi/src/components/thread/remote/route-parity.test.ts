import { afterEach, describe, expect, test } from "bun:test"

import { B_ROW, createRemoteThreadFixture } from "../thread-remote-fixture"

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

describe("#13012 route parity", () => {
  test.each([false, true])("#given a resumable thread on another device #when its name is addressed with all_scope %s #then it resolves like a local resumable name", async (all_scope) => {
    const a = account({ rowState: "ended" })
    const { run } = surface(a.remote)
    expect(await run("thread_close", { thread: B_ROW.title, all_scope })).toMatchObject({
      kind: "ok", thread_id: B_ROW.durable_id, device: B_ROW.device, closed: false,
    })
    expect(a.sent).toEqual([])
  })

  test.each([false, true])("#given a uniquely matching remote title #when fuzzy handoff searches with all_scope %s #then it sends to that remote candidate", async (all_scope) => {
    const a = account({ rows: [{ ...B_ROW, title: "release planner" }] })
    const { run } = surface(a.remote)
    expect(await run("thread_handoff", { thread: "release planne", match: "fuzzy", message: "continue", all_scope })).toMatchObject({
      kind: "ok", thread: { thread_id: B_ROW.durable_id, device: B_ROW.device }, resolved_by: "fuzzy",
    })
    expect(a.sent.filter((sent) => sent.rpc?.["type"] === "admit_external_message").map((sent) => [sent.device, sent.session])).toEqual([[B_ROW.device, B_ROW.session_id]])
  })

  test("#given the account session listing fails #when a remote address is resolved #then its typed transport error survives the resolver", async () => {
    const a = account({ failSessionsList: true })
    const { run } = surface(a.remote)
    expect(await run("thread_read", { thread: B_ROW.durable_id })).toMatchObject({
      kind: "error", error: { code: "host_unavailable" },
    })
    expect(a.sent).toEqual([])
  })

  test("#given remote sessions are disconnected #when a remote name is resolved #then it reports typed unavailability", async () => {
    const a = account({ plan: "disconnected" })
    const { run } = surface(a.remote)
    expect(await run("thread_read", { thread: B_ROW.title })).toMatchObject({
      kind: "error", error: { code: "host_unavailable", details: { state: "disconnected" } },
    })
    expect(a.sent).toEqual([])
  })

  test("#given another thread on the target device holds a name #when a remote rename also claims an alias #then the collision refuses before either mutation", async () => {
    const a = account({ rows: [B_ROW, { ...B_ROW, session_id: "rk-other", durable_id: "dur-other", title: "Release Planner", state: "ended" }] })
    const { run } = surface(a.remote)
    expect(await run("thread_rename", { thread: B_ROW.durable_id, name: "release  planner", alias: "kept-free" })).toMatchObject({
      kind: "error", error: { code: "name_conflict" },
    })
    expect(a.aliases.has("kept-free")).toBe(false)
    expect(a.sent).toEqual([])
  })

  test("#given only this device holds a name #when another device's thread takes it #then that device's conflict set permits the rename", async () => {
    const a = account()
    const { run } = surface(a.remote)
    expect(await run("thread_rename", { thread: B_ROW.durable_id, name: "local peer" })).toMatchObject({
      kind: "ok", thread_id: B_ROW.durable_id, name: "local peer", device: B_ROW.device,
    })
    expect(a.sent.map((sent) => sent.rpc?.["type"])).toEqual(["set_session_name"])
  })
})
