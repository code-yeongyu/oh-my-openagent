import { Database } from "bun:sqlite"
import { afterEach, describe, expect, test } from "bun:test"
import type { ThreadToolResult } from "../contracts"
import { gatewayDatabasePath } from "../gateway/paths"
import { B_ROW, comparable, createRemoteThreadFixture } from "../thread-remote-fixture"
import type { ThreadHostSession } from "../tools"

// #12884 (part of #12879): thread_create (new / open existing / fork) is one body over the SessionHost port. The same
// checks run in the same order on both legs, the open_session frame carries the creator's approval mode on both legs,
// a name is checked against the TARGET device's visible threads, an already-live thread is answered without a second
// open, and the creator record and the alias follow the open on both legs.

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

const ENDED_ROW = { ...B_ROW, state: "ended" }
const caller: ThreadHostSession = {
  sessionId: "route-caller",
  durableSessionId: "dur-caller",
  cwd: process.cwd(),
  name: "caller",
  status: "open",
}
const local: ThreadHostSession = {
  sessionId: "route-local",
  durableSessionId: "dur-local",
  cwd: process.cwd(),
  name: "local peer",
  status: "open",
}

const openFrames = (sent: ReturnType<typeof account>["sent"]) =>
  sent.filter((entry) => entry.rpc?.["type"] === "open_session").map((entry) => entry.rpc)
const localOpenFrames = (openSession: ReturnType<typeof surface>["openSession"]) =>
  openSession.mock.calls.map((call) => (call as unknown as [Record<string, unknown>])[0])
const SUMMARY_FIELDS = ["thread_id", "name", "status", "cwd", "created_at", "updated_at", "link"] as const
const creators = (agentDir: string): Array<[string, string]> => {
  const db = new Database(gatewayDatabasePath(agentDir), { readonly: true })
  try {
    return (
      db
        .query("SELECT creator_durable_id, created_durable_id FROM thread_creations ORDER BY created_durable_id")
        .all() as Array<{ creator_durable_id: string; created_durable_id: string }>
    ).map((row) => [row.creator_durable_id, row.created_durable_id])
  } finally {
    db.close()
  }
}

describe("SessionHost: a new thread starts in its creator's approval mode on both legs", () => {
  test("#given a creator in ask #when it creates here and on b #then both open_session frames name ask and the results have one shape", async () => {
    const a = account()
    const { run, openSession } = surface({ ...a.remote, permissionPreset: () => "ask" })
    const here = (await run("thread_create", { name: "child here" })) as Extract<ThreadToolResult, { kind: "ok" }> & {
      thread: Record<string, unknown>
    }
    const there = (await run("thread_create", { device: "studio", name: "child there" })) as Extract<
      ThreadToolResult,
      { kind: "ok" }
    > & { thread: Record<string, unknown> }
    expect(here).toMatchObject({
      kind: "ok",
      thread: { thread_id: "dur-created-here", status: "live" },
      deduplicated: false,
    })
    expect(there).toMatchObject({
      kind: "ok",
      thread: { thread_id: "dur-new-on-b", name: "child there", status: "live", device: "b" },
      deduplicated: false,
    })
    expect(localOpenFrames(openSession)).toEqual([
      expect.objectContaining({ permissionPreset: "ask", name: "child here" }),
    ])
    expect(openFrames(a.sent)).toEqual([expect.objectContaining({ permissionPreset: "ask" })])
    expect(a.sent.map((entry) => entry.rpc?.["type"])).toEqual(["open_session", "set_session_name"])
    expect(Object.keys(there).sort()).toEqual(Object.keys(here).sort())
    for (const field of SUMMARY_FIELDS) {
      expect(typeof here.thread[field]).toBe("string")
      expect(typeof there.thread[field]).toBe("string")
    }
  })

  test("#given a creator in ask #when it forks a thread here and one on b #then both open_session frames name ask and forkFrom", async () => {
    const a = account()
    const { run, openSession } = surface({ ...a.remote, permissionPreset: () => "ask" })
    expect(await run("thread_create", { fork_from: "dur-local" })).toMatchObject({
      kind: "ok",
      thread: { thread_id: "dur-created-here" },
      deduplicated: false,
    })
    expect(await run("thread_create", { fork_from: "dur-on-b" })).toMatchObject({
      kind: "ok",
      thread: { thread_id: "dur-new-on-b", device: "b" },
      deduplicated: false,
    })
    expect(localOpenFrames(openSession)).toEqual([
      expect.objectContaining({ forkFrom: "dur-local", permissionPreset: "ask" }),
    ])
    expect(openFrames(a.sent)).toEqual([expect.objectContaining({ forkFrom: "dur-on-b", permissionPreset: "ask" })])
  })

  test("#given a creator that names no preset #when it creates on both legs #then neither frame carries permissionPreset", async () => {
    const a = account()
    const { run, openSession } = surface(a.remote)
    await run("thread_create", {})
    await run("thread_create", { device: "studio" })
    expect(localOpenFrames(openSession)).toEqual([expect.not.objectContaining({ permissionPreset: expect.anything() })])
    expect(openFrames(a.sent)).toEqual([expect.not.objectContaining({ permissionPreset: expect.anything() })])
  })

  test("#given a creator working in its own folder #when it creates here and on b with no cwd #then only the open here starts in the creator's folder", async () => {
    const a = account()
    const { run, openSession } = surface(a.remote)
    await run("thread_create", {})
    await run("thread_create", { device: "studio" })
    // b never sees this device's folders: its engine picks its own.
    expect(localOpenFrames(openSession)).toEqual([expect.objectContaining({ cwd: process.cwd() })])
    expect(openFrames(a.sent)).toEqual([expect.not.objectContaining({ cwd: expect.anything() })])
  })
})

describe("SessionHost: opening an existing thread on both legs", () => {
  test("#given a thread live here and one live on b #when thread_create opens each by id #then both are deduplicated and nothing is opened anywhere", async () => {
    const a = account()
    const { run, openSession } = surface({ ...a.remote, permissionPreset: () => "ask" })
    const here = await run("thread_create", { thread: "dur-local" })
    const there = await run("thread_create", { thread: "dur-on-b" })
    expect(here).toMatchObject({
      kind: "ok",
      thread: { thread_id: "dur-local", name: "local peer", status: "live" },
      deduplicated: true,
    })
    expect(there).toMatchObject({
      kind: "ok",
      thread: { thread_id: "dur-on-b", name: "on b", status: "live", device: "b" },
      deduplicated: true,
    })
    expect(openSession).not.toHaveBeenCalled()
    expect(a.sent).toEqual([])
  })

  test("#given a session file here and an ended session on b #when thread_create opens each by id #then each is opened from its file with no preset, on its own device", async () => {
    const a = account({ rows: [ENDED_ROW] })
    const { run, openSession } = surface(
      { ...a.remote, permissionPreset: () => "ask" },
      { diskSessions: ["dur-on-disk"] },
    )
    const here = await run("thread_create", { thread: "dur-on-disk" })
    const there = await run("thread_create", { thread: "dur-on-b" })
    expect(here).toMatchObject({ kind: "ok", thread: { thread_id: "dur-created-here" }, deduplicated: false })
    expect(there).toMatchObject({ kind: "ok", thread: { thread_id: "dur-on-b", device: "b" }, deduplicated: false })
    expect(localOpenFrames(openSession)).toEqual([{ sessionPath: expect.stringContaining("dur-on-disk.jsonl") }])
    expect(a.sent).toEqual([
      {
        via: "endpoint",
        device: "b",
        rpc: { type: "open_session", retain_on_disconnect: true, sessionPath: B_ROW.path },
      },
    ])
  })
})

describe("SessionHost: a name is checked against the device the thread lands on", () => {
  test("#given b lists a thread named 'on b' #when thread_create makes 'on b' on b, and 'local peer' here #then both are name_conflict with one shape and nothing is opened", async () => {
    const a = account()
    const { run, openSession } = surface(a.remote)
    const there = await run("thread_create", { device: "studio", name: "On B" })
    const here = await run("thread_create", { name: "Local Peer" })
    expect(there).toMatchObject({
      kind: "error",
      error: { code: "name_conflict", details: { candidates: [{ id: "dur-on-b", name: "on b" }] } },
    })
    expect(here).toMatchObject({
      kind: "error",
      error: { code: "name_conflict", details: { candidates: [{ id: "dur-local", name: "local peer" }] } },
    })
    expect(Object.keys(comparable(there) as object)).toEqual(Object.keys(comparable(here) as object))
    expect(openSession).not.toHaveBeenCalled()
    expect(a.sent).toEqual([])
  })

  test("#given b's name is ended there #when thread_create reuses it on b #then it opens: an ended session's name is free", async () => {
    const a = account({ rows: [ENDED_ROW] })
    const { run } = surface(a.remote)
    expect(await run("thread_create", { device: "studio", name: "on b" })).toMatchObject({
      kind: "ok",
      thread: { thread_id: "dur-new-on-b", device: "b" },
    })
  })
})

describe("SessionHost: the creator record and the alias follow the open on both legs", () => {
  test("#given a listed caller #when it creates here and on b #then both created threads are recorded as its creations; an opened existing thread is not", async () => {
    const a = account({ rows: [ENDED_ROW] })
    const { run, agentDir } = surface(a.remote, { sessions: [caller, local] })
    expect(await run("thread_create", { name: "mine here" })).toMatchObject({ kind: "ok" })
    expect(await run("thread_create", { device: "studio", name: "mine there" })).toMatchObject({ kind: "ok" })
    expect(await run("thread_create", { thread: "dur-on-b" })).toMatchObject({ kind: "ok", deduplicated: false })
    expect(creators(agentDir)).toEqual([
      ["dur-caller", "dur-created-here"],
      ["dur-caller", "dur-new-on-b"],
    ])
  })

  test("#given a free alias #when a create on b claims it #then the alias is held by the new thread on b, as a local create's is held here", async () => {
    const a = account()
    const { run } = surface(a.remote)
    expect(await run("thread_create", { device: "studio", alias: "bee" })).toMatchObject({
      kind: "ok",
      thread: { thread_id: "dur-new-on-b", alias: "bee", device: "b" },
    })
    expect(await run("thread_create", { alias: "me" })).toMatchObject({
      kind: "ok",
      thread: { thread_id: "dur-created-here", alias: "me" },
    })
    expect(a.aliases.get("bee")).toEqual({ session_id: "dur-new-on-b", device: "b" })
    expect(a.aliases.get("me")).toEqual({ session_id: "dur-created-here", device: "here" })
  })

  test("#given skills on a create #when it opens here and on b #then both results name the requested skills and both frames carry the initial-skills context", async () => {
    const a = account()
    const { run, openSession } = surface(a.remote)
    const here = (await run("thread_create", { skills: ["programming"] })) as Extract<ThreadToolResult, { kind: "ok" }>
    const there = (await run("thread_create", { device: "studio", skills: ["programming"] })) as Extract<
      ThreadToolResult,
      { kind: "ok" }
    >
    expect(here).toMatchObject({ thread: { requested_skills: ["programming"] } })
    expect(there).toMatchObject({ thread: { requested_skills: ["programming"] } })
    expect(localOpenFrames(openSession)).toEqual([expect.objectContaining({ initialSkills: ["programming"] })])
    expect(openFrames(a.sent)).toEqual([
      expect.objectContaining({ context: { initial_skills: JSON.stringify(["programming"]) } }),
    ])
  })
})
