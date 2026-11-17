import { afterEach, describe, expect, test } from "bun:test"
import { createRemoteThreadFixture } from "./thread-remote-fixture"
import type { ThreadHostSession } from "./tools"

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

const UNLOAD = { type: "unload_session", sessionId: "rk-on-b", force: true, interrupt: true, children: "detach" }

describe("thread_close: close a thread on this device or on another one", () => {
  test("#given a live thread on this device #when thread_close names it and is retried #then its host closes it once and the retry replays the answer", async () => {
    const a = account()
    const { run, closed } = surface(a.remote)
    const input = { thread: "dur-local", idempotency_key: "close-once" }
    expect(await run("thread_close", input)).toEqual({
      kind: "ok",
      thread: "dur-local",
      closed: true,
      reason: "closed",
    })
    expect(await run("thread_close", input)).toEqual({
      kind: "ok",
      thread: "dur-local",
      closed: true,
      reason: "closed",
    })
    expect(closed).toEqual([["route-local", "dur-local"]])
    expect(a.sent).toEqual([])
  })

  test("#given a local session that left its host before the close reached it #when thread_close names it #then it answers closed false", async () => {
    const { run } = surface(undefined, { closeOutcome: "not_live" })
    expect(await run("thread_close", { thread: "dur-local" })).toEqual({
      kind: "ok",
      thread: "dur-local",
      closed: false,
      reason: "not_live",
    })
  })

  test("#given a local session another client still holds after the close #when thread_close names it #then it is refused foreign_live_owner", async () => {
    const { run } = surface(undefined, { closeOutcome: "held_elsewhere" })
    expect(await run("thread_close", { thread: "dur-local" })).toMatchObject({
      kind: "error",
      error: { code: "foreign_live_owner" },
    })
  })

  test("#given a thread on device b that another client also holds #when thread_close names it #then b's engine ends it for every holder and the answer names b", async () => {
    const a = account({ otherHolders: 1 })
    const { run, closed } = surface(a.remote)
    expect(await run("thread_close", { thread: "dur-on-b" })).toEqual({
      kind: "ok",
      thread: "dur-on-b",
      closed: true,
      reason: "closed",
      device: "b",
    })
    expect(a.live.has("rk-on-b")).toBe(false)
    expect(a.sent.map((entry) => [entry.via, entry.device, entry.rpc])).toEqual([["session", "b", UNLOAD]])
    expect(closed).toEqual([])
  })

  test("#given a thread on device b with no session file yet #when thread_close names it #then b closes it through the attached close_session", async () => {
    const a = account({ unwritten: true })
    const { run } = surface(a.remote)
    expect(await run("thread_close", { thread: "dur-on-b" })).toEqual({
      kind: "ok",
      thread: "dur-on-b",
      closed: true,
      reason: "closed",
      device: "b",
    })
    expect(a.live.has("rk-on-b")).toBe(false)
    expect(a.sent.map((entry) => [entry.via, entry.rpc?.["type"]])).toEqual([
      ["session", "unload_session"],
      ["session", "close_session"],
      ["session", "get_state"],
    ])
  })

  test("#given a thread on device b with no session file that another client holds #when thread_close names it #then it is refused foreign_live_owner naming b", async () => {
    const a = account({ unwritten: true, otherHolders: 1 })
    const { run } = surface(a.remote)
    expect(await run("thread_close", { thread: "dur-on-b" })).toMatchObject({
      kind: "error",
      error: { code: "foreign_live_owner", details: { device: "b" } },
    })
    expect(a.live.has("rk-on-b")).toBe(true)
  })

  test("#given a thread on device b whose session has ended #when thread_close names it #then it answers closed false and sends nothing", async () => {
    const a = account({ rowState: "ended", live: [] })
    const { run } = surface(a.remote)
    expect(await run("thread_close", { thread: "dur-on-b" })).toEqual({
      kind: "ok",
      thread: "dur-on-b",
      closed: false,
      reason: "not_live",
      device: "b",
    })
    expect(a.sent).toEqual([])
  })

  test("#given a thread on device b that left its engine after the listing #when thread_close names it #then it answers closed false", async () => {
    const a = account({ live: [] })
    const { run } = surface(a.remote)
    expect(await run("thread_close", { thread: "dur-on-b" })).toEqual({
      kind: "ok",
      thread: "dur-on-b",
      closed: false,
      reason: "not_live",
      device: "b",
    })
  })

  test("#given a thread with a session file but no live owner #when thread_close names it #then it answers closed false and closes nothing", async () => {
    const a = account()
    const { run, closed } = surface(a.remote, { diskSessions: ["dur-saved"] })
    expect(await run("thread_close", { thread: "dur-saved" })).toEqual({
      kind: "ok",
      thread: "dur-saved",
      closed: false,
      reason: "not_live",
    })
    expect(closed).toEqual([])
  })

  test("#given a thread held by an interactive terminal #when thread_close names it #then it is refused unsupported and the terminal keeps it", async () => {
    const terminal: ThreadHostSession = {
      sessionId: "route-tui",
      durableSessionId: "dur-tui",
      cwd: process.cwd(),
      name: "terminal",
      status: "open",
      endpoint_kind: "tui",
    }
    const { run, closed } = surface(undefined, { sessions: [terminal] })
    expect(await run("thread_close", { thread: "dur-tui" })).toMatchObject({
      kind: "error",
      error: { code: "unsupported" },
    })
    expect(closed).toEqual([])
  })

  test("#given b's engine refuses the unload with a reason the ladder does not know #when thread_close names b's thread #then it is typed unsupported naming the reason and b, and nothing else is sent", async () => {
    const a = account({ unloadReason: "attached" })
    const { run } = surface(a.remote)
    expect(await run("thread_close", { thread: "dur-on-b" })).toMatchObject({
      kind: "error",
      error: { code: "unsupported", details: { device: "b", command: "unload_session", reason: "attached" } },
    })
    expect(a.sent.map((entry) => entry.rpc?.["type"])).toEqual(["unload_session"])
    expect(a.live.has("rk-on-b")).toBe(true)
  })

  test("#given device b refuses the command #when thread_close names a thread on b #then the refusal is data naming b", async () => {
    const a = account({ refuse: "host_detached" })
    const { run } = surface(a.remote)
    expect(await run("thread_close", { thread: "dur-on-b" })).toMatchObject({
      kind: "error",
      error: { code: "host_unavailable", details: { device: "b", reason: "host_detached" } },
    })
  })

  test("#given this session #when thread_close omits thread #then it closes the caller and reports closed", async () => {
    const a = account()
    const { run, closed } = surface(a.remote, { caller: "dur-local" })
    expect(await run("thread_close", {})).toEqual({
      kind: "ok",
      thread: "dur-local",
      closed: true,
      reason: "closed",
    })
    expect(closed).toEqual([["route-local", "dur-local"]])
  })

  test("#given a local session listed as route-local #when thread_close names that sessionId #then it closes the durable thread", async () => {
    const a = account()
    const { run, closed } = surface(a.remote)
    expect(await run("thread_close", { thread: "route-local" })).toEqual({
      kind: "ok",
      thread: "dur-local",
      closed: true,
      reason: "closed",
    })
    expect(closed).toEqual([["route-local", "dur-local"]])
  })

  test("#given b lists a short session id distinct from its durable id #when thread_close names the session id #then b's session is closed and the result names the durable id", async () => {
    const a = account()
    const { run } = surface(a.remote)
    expect(await run("thread_close", { thread: "rk-on-b" })).toEqual({
      kind: "ok",
      thread: "dur-on-b",
      closed: true,
      reason: "closed",
      device: "b",
    })
    expect(a.sent.map((entry) => [entry.via, entry.device, entry.rpc])).toEqual([["session", "b", UNLOAD]])
    expect(a.live.has("rk-on-b")).toBe(false)
  })

  test("#given no thread has sessionId rpc-9 #when thread_close names it #then not_found names the thread value to pass and a visible one", async () => {
    const a = account()
    const { run } = surface(a.remote)
    const result = await run("thread_close", { thread: "rpc-9" })
    expect(result).toMatchObject({ kind: "error", error: { code: "not_found" } })
    if (result.kind !== "error") throw new Error("expected not_found")
    expect(result.error.message).toContain("thread value")
    expect(result.error.message).toContain("dur-local")
    expect(result.error.next_action).toContain("thread value")
  })
})
