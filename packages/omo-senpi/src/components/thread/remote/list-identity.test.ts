import { afterEach, describe, expect, test } from "bun:test"
import { resolveAddress } from "../address"
import type { ThreadToolResult } from "../contracts"
import { createRelaySessionHost } from "../control/relay-session-host"
import { B_ROW, createRemoteThreadFixture } from "../thread-remote-fixture"
import { UNKNOWN_CALLER } from "../tools/ports"
import { listAcross } from "./cross-device"
import type { RemoteListing, RemoteThreadSurface } from "./ports"

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

describe("thread_list row times (#14474)", () => {
  test("#given b lists a session whose thread id is a UUIDv7 #when thread_list runs #then created_at is the time in the id and updated_at the row's own", async () => {
    // 0x019a8d7c5e00 ms is 2025-11-16T16:25:29.344Z; B_ROW's updated_ms is 2023-11-14T22:13:20.000Z.
    const v7 = { ...B_ROW, session_id: "rk-v7", durable_id: "019a8d7c-5e00-7abc-8def-0123456789ab", title: "v7 on b" }
    const listed = onB(await surface(account({ rows: [v7] }).remote).run("thread_list", {}))
    expect(listed.map((thread) => [thread.created_at, thread.updated_at])).toEqual([
      ["2025-11-16T16:25:29.344Z", "2023-11-14T22:13:20.000Z"],
    ])
  })

  test("#given b lists a session whose thread id is no UUIDv7 #when thread_list runs #then created_at stays the row's time", async () => {
    const listed = onB(await surface(account().remote).run("thread_list", {}))
    expect(listed.map((thread) => [thread.created_at, thread.updated_at])).toEqual([
      ["2023-11-14T22:13:20.000Z", "2023-11-14T22:13:20.000Z"],
    ])
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
    const a = account({ rows: [{ ...B_ROW, title: "", path: "/work/notes", project: "/work/notes" }] })
    const { run } = surface(a.remote)
    expect(onB(await run("thread_list", {})).map((thread) => thread.name)).toEqual(["notes"])
    expect(await run("thread_set_model", { thread: "notes", model: "opus" })).toMatchObject({
      kind: "error",
      error: { code: "not_found" },
    })
    expect(a.sent.filter((entry) => entry.rpc?.["type"] === "set_model")).toEqual([])
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

describe("thread_list feeds the module's one last-listed memory (#14172, review M1 of #14386)", () => {
  test("#given thread_list listed a thread on b #when the next round misses b and that thread is addressed #then the resolver answers host_unavailable listing_incomplete naming b alone, never not_found", async () => {
    const a = account({ devices: [{ device: "c", label: "c-mac", online: true }] })
    const listing = a.remote.sessions.listing
    if (listing === undefined) throw new Error("the fixture's sessions port has no listing")
    let round: (filter?: { readonly device?: string }) => Promise<RemoteListing> = listing
    const remote: RemoteThreadSurface = {
      ...a.remote,
      sessions: { ...a.remote.sessions, listing: (filter) => round(filter) },
    }
    const listed = await listAcross(remote, { kind: "ok", threads: [], scope: "all" }, true)
    expect(rows(listed).map((thread) => thread.thread)).toContain("dur-on-b")
    // b and c both miss this round: only the memory of thread_list's round ties the thread to b.
    round = async () => ({ rows: [], incomplete: ["b", "c"] })
    const missed = await resolveAddress(
      { remote, callerWorkspaceRoot: "", local: [], callerId: UNKNOWN_CALLER },
      "dur-on-b",
      { all_scope: true },
    )
    expect(missed).toMatchObject({
      kind: "error",
      code: "host_unavailable",
      details: { reason: "listing_incomplete", devices: ["b"] },
    })
  })
})

describe("an open on another device names that device by its id (review L1)", () => {
  test("#given an id the roster misses that is another device's name #when the relay host opens a session on it #then not_found and nothing is opened on that other device", async () => {
    const a = account()
    const opened = await createRelaySessionHost(a.remote, "studio").open({ cwd: "/work/b" })
    expect(opened).toMatchObject({ kind: "error", error: { code: "not_found", details: { device: "studio" } } })
    expect(a.sent.filter((entry) => entry.rpc?.["type"] === "open_session")).toEqual([])
  })
})
