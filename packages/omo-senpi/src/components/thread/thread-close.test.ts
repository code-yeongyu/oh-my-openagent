import { afterEach, describe, expect, test } from "bun:test"
import { createRemoteThreadFixture } from "./thread-remote-fixture"
import type { ThreadHostSession } from "./tools"

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

const UNLOAD = { type: "unload_session", sessionId: "dur-on-b", force: true, interrupt: true, children: "detach" }

describe("thread_close: close a thread on this device or on another one", () => {
  test("#given a live thread on this device #when thread_close names it and is retried #then its host closes it once and the retry replays the answer", async () => {
    const a = account()
    const { run, closed } = surface(a.remote)
    const input = { thread: "dur-local", idempotency_key: "close-once" }
    expect(await run("thread_close", input)).toEqual({ kind: "ok", thread_id: "dur-local", closed: true })
    expect(await run("thread_close", input)).toEqual({ kind: "ok", thread_id: "dur-local", closed: true })
    expect(closed).toEqual([["route-local", "dur-local"]])
    expect(a.sent).toEqual([])
  })

  test("#given a local session that left its host before the close reached it #when thread_close names it #then it answers closed false", async () => {
    const { run } = surface(undefined, { closeOutcome: "not_live" })
    expect(await run("thread_close", { thread: "dur-local" })).toEqual({ kind: "ok", thread_id: "dur-local", closed: false })
  })

  test("#given a local session another client still holds after the close #when thread_close names it #then it is refused foreign_live_owner", async () => {
    const { run } = surface(undefined, { closeOutcome: "held_elsewhere" })
    expect(await run("thread_close", { thread: "dur-local" })).toMatchObject({ kind: "error", error: { code: "foreign_live_owner" } })
  })

  test("#given a thread on device b that another client also holds #when thread_close names it #then b's engine ends it for every holder and the answer names b", async () => {
    const a = account({ otherHolders: 1 })
    const { run, closed } = surface(a.remote)
    expect(await run("thread_close", { thread: "dur-on-b" })).toEqual({ kind: "ok", thread_id: "dur-on-b", closed: true, device: "b" })
    expect(a.live.has("dur-on-b")).toBe(false)
    expect(a.sent.map((entry) => [entry.via, entry.device, entry.rpc])).toEqual([["session", "b", UNLOAD]])
    expect(closed).toEqual([])
  })

  test("#given a thread on device b with no session file yet #when thread_close names it #then b closes it through the attached close_session", async () => {
    const a = account({ unwritten: true })
    const { run } = surface(a.remote)
    expect(await run("thread_close", { thread: "dur-on-b" })).toEqual({ kind: "ok", thread_id: "dur-on-b", closed: true, device: "b" })
    expect(a.live.has("dur-on-b")).toBe(false)
    expect(a.sent.map((entry) => [entry.via, entry.rpc?.["type"]])).toEqual([["session", "unload_session"], ["session", "close_session"], ["session", "get_state"]])
  })

  test("#given a thread on device b with no session file that another client holds #when thread_close names it #then it is refused foreign_live_owner naming b", async () => {
    const a = account({ unwritten: true, otherHolders: 1 })
    const { run } = surface(a.remote)
    expect(await run("thread_close", { thread: "dur-on-b" })).toMatchObject({ kind: "error", error: { code: "foreign_live_owner", details: { device: "b" } } })
    expect(a.live.has("dur-on-b")).toBe(true)
  })

  test("#given a thread on device b whose session has ended #when thread_close names it #then it answers closed false and sends nothing", async () => {
    const a = account({ rowState: "ended", live: [] })
    const { run } = surface(a.remote)
    expect(await run("thread_close", { thread: "dur-on-b" })).toEqual({ kind: "ok", thread_id: "dur-on-b", closed: false, device: "b" })
    expect(a.sent).toEqual([])
  })

  test("#given a thread on device b that left its engine after the listing #when thread_close names it #then it answers closed false", async () => {
    const a = account({ live: [] })
    const { run } = surface(a.remote)
    expect(await run("thread_close", { thread: "dur-on-b" })).toEqual({ kind: "ok", thread_id: "dur-on-b", closed: false, device: "b" })
  })

  test("#given a thread with a session file but no live owner #when thread_close names it #then it answers closed false and closes nothing", async () => {
    const a = account()
    const { run, closed } = surface(a.remote, { diskSessions: ["dur-saved"] })
    expect(await run("thread_close", { thread: "dur-saved" })).toEqual({ kind: "ok", thread_id: "dur-saved", closed: false })
    expect(closed).toEqual([])
  })

  test("#given a thread held by an interactive terminal #when thread_close names it #then it is refused unsupported and the terminal keeps it", async () => {
    const terminal: ThreadHostSession = { sessionId: "route-tui", durableSessionId: "dur-tui", cwd: process.cwd(), name: "terminal", status: "open", endpoint_kind: "tui" }
    const { run, closed } = surface(undefined, { sessions: [terminal] })
    expect(await run("thread_close", { thread: "dur-tui" })).toMatchObject({ kind: "error", error: { code: "unsupported" } })
    expect(closed).toEqual([])
  })

  test("#given device b refuses the command #when thread_close names a thread on b #then the refusal is data naming b", async () => {
    const a = account({ refuse: "host_detached" })
    const { run } = surface(a.remote)
    expect(await run("thread_close", { thread: "dur-on-b" })).toMatchObject({ kind: "error", error: { code: "host_unavailable", details: { device: "b", reason: "host_detached" } } })
  })
})
