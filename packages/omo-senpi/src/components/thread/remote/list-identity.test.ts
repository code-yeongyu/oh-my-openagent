import { afterEach, describe, expect, test } from "bun:test"
import type { ThreadToolResult } from "../contracts"
import { B_ROW, createRemoteThreadFixture } from "../thread-remote-fixture"

// #14305 U6 (design section 6): the list names every row by the same identity and the same name the resolver uses, so a
// listed row is an address and the list and an address answer about the same row.

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

const rows = (listed: ThreadToolResult) => (listed.kind === "ok" && "threads" in listed ? listed.threads : [])
const onB = (listed: ThreadToolResult) => rows(listed).filter((thread) => thread.device === "b")

// b's engine publishes no durable id for this session: the listing names it only by its listing key.
const ANON = { ...B_ROW, session_id: "rk-anon", durable_id: undefined, title: "anon on b" }

describe("thread_list row identity (#14305 U6)", () => {
  test("#given b lists a session that publishes no thread id #when thread_list runs #then its thread is <device id>/<listing key>, never empty, and that thread addresses it", async () => {
    const a = account({ rows: [B_ROW, ANON], live: ["rk-on-b", "dur-on-b", "rk-anon"] })
    const { run } = surface(a.remote)
    const listed = await run("thread_list", { all_scope: true })
    const anon = onB(listed).find((thread) => thread.name === "anon on b")
    expect(anon?.thread).toBe("b/rk-anon")
    expect(anon?.link).toContain(encodeURIComponent("b/rk-anon"))
    const changed = await run("thread_set_model", { thread: anon?.thread ?? "", model: "opus" })
    expect(changed).toMatchObject({ kind: "ok", device: "b" })
    expect(a.sent.filter((entry) => entry.rpc?.["type"] === "set_model").map((entry) => entry.session)).toEqual([
      "rk-anon",
    ])
  })

  test("#given b lists this device's thread under the same thread id #when thread_list runs #then the thread is one row, this device's", async () => {
    const copy = { ...B_ROW, session_id: "rk-copy", durable_id: "dur-local", title: "stale copy" }
    const listed = await surface(account({ rows: [B_ROW, copy] }).remote).run("thread_list", { all_scope: true })
    expect(
      rows(listed)
        .filter((thread) => thread.thread === "dur-local")
        .map((thread) => thread.device),
    ).toEqual([undefined])
  })
})

describe("thread_list row names (#14305 U6)", () => {
  test("#given b lists a session with no name #when thread_list runs with and without a state filter #then the row shows the same fallback both times and says unnamed", async () => {
    const { run } = surface(account({ rows: [{ ...B_ROW, title: "" }] }).remote)
    const plain = onB(await run("thread_list", {}))
    const filtered = onB(await run("thread_list", { state: ["idle"] }))
    expect(plain.map((thread) => [thread.name, thread.unnamed])).toEqual([["b", true]])
    expect(filtered.map((thread) => [thread.name, thread.unnamed])).toEqual([["b", true]])
  })

  test("#given b lists a named session #when thread_list runs #then the row carries its name and no unnamed flag", async () => {
    const listed = onB(await surface(account().remote).run("thread_list", {}))
    expect(listed.map((thread) => [thread.name, "unnamed" in thread])).toEqual([["on b", false]])
  })

  test("#given b lists a session with no name #when its folder name is used as an address #then it is no address: only a real name is", async () => {
    const { run } = surface(account({ rows: [{ ...B_ROW, title: "" }] }).remote)
    expect(await run("thread_set_model", { thread: "b", model: "opus" })).toMatchObject({ kind: "error" })
  })
})

describe("one per-device listing state for the list and the resolver (#14305 U6)", () => {
  test("#given b did not answer this round in full #when thread_list runs and an address misses #then the list names b incomplete and the miss is host_unavailable naming b, never not_found", async () => {
    const a = account({ incomplete: ["b"] })
    const { run } = surface(a.remote)
    const listed = await run("thread_list", {})
    expect(listed.kind === "ok" && "devices" in listed && listed.devices?.find((d) => d.device === "b")?.listing).toBe(
      "incomplete",
    )
    const missed = await run("thread_set_model", { thread: "no-such-thread-name", model: "opus" })
    expect(missed).toMatchObject({ kind: "error", error: { code: "host_unavailable" } })
    expect(JSON.stringify(missed)).toContain('"b"')
  })
})
