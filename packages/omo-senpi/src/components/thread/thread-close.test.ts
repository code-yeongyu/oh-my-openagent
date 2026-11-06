import { afterEach, describe, expect, test } from "bun:test"
import { createRemoteThreadFixture } from "./thread-remote-fixture"
import type { ThreadHostSession } from "./tools"

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

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

  test("#given a thread on device b #when thread_close names it #then b's engine gets close_session for that session and the answer names b", async () => {
    const a = account()
    const { run, closed } = surface(a.remote)
    expect(await run("thread_close", { thread: "dur-on-b" })).toEqual({ kind: "ok", thread_id: "dur-on-b", closed: true, device: "b" })
    expect(a.sent.map((entry) => [entry.via, entry.device, entry.rpc])).toEqual([["endpoint", "b", { type: "close_session", sessionId: "dur-on-b" }]])
    expect(closed).toEqual([])
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
