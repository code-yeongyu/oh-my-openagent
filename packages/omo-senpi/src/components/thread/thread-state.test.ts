import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { readDiskSession } from "./address-book"
import type { ThreadToolResult } from "./contracts"
import { createGatewayStore } from "./gateway/store"
import type { RemoteSessionRow } from "./remote/ports"
import { B_ROW, createRemoteThreadFixture } from "./thread-remote-fixture"
import { createThreadTools } from "./tools"
import { listThreads } from "./tools/read-ops"
import type { ThreadHost, ThreadHostSession, ThreadHostView, ThreadToolSurfaceOptions } from "./tools/ports"

// A thread's state is one of running | idle | inactive | archived (#13403, #13407, #13411): `online` is a device's,
// never a thread's, so no row carries `alive`.

const directories: string[] = []
const remoteFixture = createRemoteThreadFixture()

afterEach(async () => {
  await remoteFixture.cleanup()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function scratch(): string {
  const directory = mkdtempSync(join(tmpdir(), "omo-thread-state-"))
  directories.push(directory)
  return directory
}

const ARCHIVED = (archived: boolean, timestamp: string) => ({
  type: "custom",
  customType: "session_archived",
  data: { archived },
  id: `a-${timestamp}`,
  parentId: null,
  timestamp,
})

function sessionFile(directory: string, id: string, extra: readonly object[] = []): string {
  const path = join(directory, `${id}.jsonl`)
  const entries = [
    { type: "session", version: 3, id, cwd: directory, timestamp: "2026-11-14T01:00:00.000Z" },
    { type: "message", timestamp: "2026-11-14T01:01:00.000Z", message: { role: "user", content: `about ${id}` } },
    ...extra,
  ]
  writeFileSync(path, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`)
  return path
}

function surfaceOptions(directory: string): ThreadToolSurfaceOptions {
  const unused = async (): Promise<never> => {
    throw new Error("not used by thread list")
  }
  const host: ThreadHost = {
    socket: "/tmp/thread-state.sock",
    listSessions: unused,
    openSession: unused,
    getMessages: unused,
    getState: unused,
    prompt: unused,
    interrupt: unused,
    setSessionName: unused,
    setModel: unused,
    getAvailableModels: unused,
    setThinkingLevel: unused,
    getAvailableThinkingLevels: unused,
  }
  return {
    host,
    callerSessionId: () => "caller",
    callerWorkspaceRoot: () => directory,
    stateDirectory: directory,
    store: createGatewayStore({ agentDir: directory }),
  }
}

const MODEL = { provider: "anthropic", id: "claude-opus-5-5" }

function localView(directory: string): ThreadHostView {
  const live = "/tmp/thread-state-live.sock"
  const row = (id: string, fields: Record<string, unknown> = {}): ThreadHostSession =>
    ({
      sessionId: id,
      durableSessionId: id,
      cwd: directory,
      status: "open",
      socket: live,
      ...fields,
    }) as ThreadHostSession
  const sessions = [
    row("l-running", { activity: "running", archived: false, model: MODEL }),
    row("l-idle", { activity: "idle", archived: false, model: MODEL }),
    // An engine from before the senpi change lists none of archived, activity or model.
    row("l-older-engine"),
    row("l-archived", { activity: "running", archived: true, model: MODEL }),
    row("l-closed", { status: "closed", activity: "idle", archived: false }),
  ]
  const dead = join(directory, "t-dead.sock")
  const disk = [
    sessionFile(directory, "d-plain"),
    sessionFile(directory, "d-archived", [ARCHIVED(true, "2026-11-14T02:00:00.000Z")]),
    sessionFile(directory, "d-unarchived", [
      ARCHIVED(true, "2026-11-14T02:00:00.000Z"),
      ARCHIVED(false, "2026-11-14T03:00:00.000Z"),
    ]),
  ].map((path) => {
    const session = readDiskSession(path, dead)
    if (session === null) throw new Error(`fixture ${path} did not parse`)
    return session
  })
  return {
    sessions,
    hosts: [
      { socket: live, endpoint_kind: "rpc_host", alive: true, list_sessions: { sessions } },
      { socket: dead, endpoint_kind: "tui", alive: false, reason: "dead", error: "dead" },
    ],
    disk,
  }
}

type Row = { readonly thread_id: string; readonly state?: string; readonly status?: string; readonly model?: unknown }

function rows(result: ThreadToolResult): readonly Row[] {
  if (result.kind !== "ok" || !("threads" in result)) throw new Error(`not a list: ${JSON.stringify(result)}`)
  return result.threads as readonly Row[]
}

const table = (result: ThreadToolResult) =>
  Object.fromEntries(
    rows(result).map((row) => [row.thread_id, { state: row.state, status: row.status, model: row.model ?? null }]),
  )

describe("thread state on this device's rows", () => {
  test("#given every kind of host row and dead-endpoint session files #when listed with every state #then state, the deprecated status and the model follow the derivation table", () => {
    const directory = scratch()
    const result = listThreads(surfaceOptions(directory), localView(directory), true, [
      "running",
      "idle",
      "inactive",
      "archived",
    ])
    expect(table(result)).toEqual({
      "l-running": { state: "running", status: "live", model: MODEL },
      "l-idle": { state: "idle", status: "live", model: MODEL },
      "l-older-engine": { state: "idle", status: "live", model: null },
      "l-archived": { state: "archived", status: "live", model: MODEL },
      "l-closed": { state: "inactive", status: "resumable", model: null },
      "d-plain": { state: "inactive", status: "resumable", model: null },
      "d-archived": { state: "archived", status: "resumable", model: null },
      "d-unarchived": { state: "inactive", status: "resumable", model: null },
    })
  })

  test("#given the same rows #when listed by default #then archived threads are hidden; state archived shows only them", () => {
    const directory = scratch()
    const options = surfaceOptions(directory)
    const listed = rows(listThreads(options, localView(directory), true)).map((row) => row.thread_id)
    expect(listed.sort()).toEqual(["d-plain", "d-unarchived", "l-closed", "l-idle", "l-older-engine", "l-running"])
    const archived = rows(listThreads(options, localView(directory), true, ["archived"])).map((row) => row.thread_id)
    expect(archived.sort()).toEqual(["d-archived", "l-archived"])
  })

  test("#given live and degraded rows #when listed #then no row carries alive or the engine's raw activity/archived fields", () => {
    const directory = scratch()
    const result = listThreads(surfaceOptions(directory), localView(directory), true, [
      "running",
      "idle",
      "inactive",
      "archived",
    ])
    for (const row of rows(result)) {
      expect(row).not.toHaveProperty("alive")
      expect(row).not.toHaveProperty("activity")
      expect(row).not.toHaveProperty("archived")
    }
  })
})

const remoteRow = (id: string, fields: Partial<RemoteSessionRow>): RemoteSessionRow => ({
  ...B_ROW,
  session_id: `rk-${id}`,
  durable_id: id,
  title: id,
  ...fields,
})

const REMOTE_ROWS: readonly RemoteSessionRow[] = [
  remoteRow("r-running", { state: "running", model: MODEL }),
  remoteRow("r-idle", { state: "idle" }),
  remoteRow("r-ended", { state: "ended", model: MODEL }),
  remoteRow("r-archived", { state: "idle", archived: true }),
  remoteRow("r-archived-ended", { state: "ended", archived: true }),
]

describe("thread state on another device's rows", () => {
  test("#given the account's rows #when listed with every state #then ended is inactive, archived wins, running and idle follow the row, and model rides along", async () => {
    const { remote } = remoteFixture.account({ rows: REMOTE_ROWS })
    const { run } = remoteFixture.surface(remote, { sessions: [] })
    const result = await run("thread_list", { state: ["running", "idle", "inactive", "archived"] })
    expect(table(result)).toEqual({
      "r-running": { state: "running", status: "live", model: MODEL },
      "r-idle": { state: "idle", status: "live", model: null },
      "r-ended": { state: "inactive", status: "resumable", model: MODEL },
      "r-archived": { state: "archived", status: "live", model: null },
      "r-archived-ended": { state: "archived", status: "resumable", model: null },
    })
    for (const row of rows(result)) expect(row).not.toHaveProperty("alive")
  })

  test("#given the account's rows #when listed by default and by state #then archived rows are hidden unless asked, and devices count only what is listed", async () => {
    const { remote } = remoteFixture.account({ rows: REMOTE_ROWS })
    const { run } = remoteFixture.surface(remote, { sessions: [] })
    const plain = await run("thread_list", {})
    expect(
      rows(plain)
        .map((row) => row.thread_id)
        .sort(),
    ).toEqual(["r-ended", "r-idle", "r-running"])
    expect(plain).toMatchObject({ devices: [{ device: "here" }, { device: "b", threads: 3 }] })
    const archived = await run("thread_list", { state: ["archived"] })
    expect(
      rows(archived)
        .map((row) => row.thread_id)
        .sort(),
    ).toEqual(["r-archived", "r-archived-ended"])
    const some = await run("thread_list", { state: ["running", "inactive"] })
    expect(
      rows(some)
        .map((row) => row.thread_id)
        .sort(),
    ).toEqual(["r-ended", "r-running"])
  })

  test("#given an offline device's cached rows (measured: 7 of an offline device's 90 rows read running) #when listed #then none reads running, each carries as_of, and archived still wins", async () => {
    const asOf = Date.UTC(2026, 10, 14, 9, 0, 0)
    const cached = REMOTE_ROWS.map((row) => ({ ...row, cached_as_of: asOf }))
    const { remote } = remoteFixture.account({ rows: cached })
    const { run } = remoteFixture.surface(remote, { sessions: [] })
    const result = await run("thread_list", { state: ["running", "idle", "inactive", "archived"] })
    expect(table(result)).toMatchObject({
      "r-running": { state: "idle" },
      "r-idle": { state: "idle" },
      "r-ended": { state: "inactive" },
      "r-archived": { state: "archived" },
    })
    for (const row of rows(result)) expect(row).toMatchObject({ as_of: new Date(asOf).toISOString() })
  })

  test("#given a state that is not one of the four #when listed #then invalid_arguments", async () => {
    const { remote } = remoteFixture.account({ rows: REMOTE_ROWS })
    const { run } = remoteFixture.surface(remote, { sessions: [] })
    expect(await run("thread_list", { state: ["live"] })).toMatchObject({
      kind: "error",
      error: { code: "invalid_arguments" },
    })
  })
})

describe("a thread its engine closed (t2pp, measured on omo 5.1.69: it vanished from thread_list)", () => {
  test("#given a listed thread #when thread_close ends it #then thread_list keeps it as inactive from its session file, thread_read reads that file, and a control answers not_resumable instead of not_found", async () => {
    const root = realpathSync(scratch())
    const sessionsDir = join(scratch(), "sessions")
    const projectDir = join(sessionsDir, `--${root.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`)
    mkdirSync(projectDir, { recursive: true })
    const sessionPath = join(projectDir, "2026-11-14T01-00-00-000Z_dur-a.jsonl")
    const entries = [
      { type: "session", version: 3, id: "dur-a", cwd: root, timestamp: "2026-11-14T01:00:00.000Z" },
      { type: "message", timestamp: "2026-11-14T01:01:00.000Z", message: { role: "user", content: "plan the move" } },
      { type: "message", timestamp: "2026-11-14T01:02:00.000Z", message: { role: "assistant", content: "done" } },
    ]
    writeFileSync(sessionPath, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`)
    const sessions: ThreadHostSession[] = [
      { sessionId: "rpc-1", durableSessionId: "dur-a", cwd: root, sessionPath, status: "open", activity: "idle" },
    ]
    const unused = async (): Promise<never> => {
      throw new Error("not used")
    }
    const host: ThreadHost = {
      socket: join(root, "rpc.sock"),
      listSessions: async () => sessions,
      openSession: unused,
      getMessages: unused,
      getState: unused,
      prompt: unused,
      interrupt: unused,
      setSessionName: unused,
      setModel: unused,
      getAvailableModels: unused,
      setThinkingLevel: unused,
      getAvailableThinkingLevels: unused,
      closeSession: async () => {
        sessions.splice(0)
        return "closed"
      },
    }
    const tools = createThreadTools({
      host,
      store: createGatewayStore({ agentDir: scratch() }),
      stateDirectory: scratch(),
      callerSessionId: () => "dur-caller",
      callerWorkspaceRoot: () => root,
      sessionsDirectory: () => sessionsDir,
    })
    const run = async (name: string, args: unknown): Promise<ThreadToolResult> => {
      const tool = tools.find((candidate) => candidate.name === name)
      if (tool === undefined) throw new Error(`${name} is not registered`)
      return (await tool.execute(`call-${name}-${Math.random()}`, args, undefined, undefined, undefined as never))
        .details.result as ThreadToolResult
    }
    expect(table(await run("thread_list", {}))).toEqual({ "dur-a": { state: "idle", status: "live", model: null } })
    expect(await run("thread_close", { thread: "dur-a" })).toMatchObject({ kind: "ok", closed: true })
    for (const scope of [{}, { all_scope: true }])
      expect(rows(await run("thread_list", scope))).toEqual([
        expect.objectContaining({ thread_id: "dur-a", state: "inactive", status: "resumable", name: "plan the move" }),
      ])
    const read = await run("thread_read", { thread: "dur-a" })
    expect(read).toMatchObject({ kind: "ok", thread_id: "dur-a", source: "session_jsonl" })
    expect(read.kind === "ok" && "items" in read ? read.items.map((item) => item.role) : []).toEqual([
      "user",
      "assistant",
    ])
    expect(read).not.toHaveProperty("error_note")
    expect(await run("thread_rename", { thread: "dur-a", name: "renamed" })).toMatchObject({
      kind: "error",
      error: { code: "not_resumable" },
    })
  })
})

describe("thread_archive", () => {
  test("#given a thread on this device #when archived and unarchived #then set_session_archived reaches its endpoint and the result names the new state", async () => {
    const { run, archived } = remoteFixture.surface(undefined)
    expect(await run("thread_archive", { thread: "dur-local" })).toMatchObject({
      kind: "ok",
      archived: true,
      thread: { thread_id: "dur-local", state: "archived", name: "local peer" },
    })
    expect(await run("thread_archive", { thread: "dur-local", archived: false })).toMatchObject({
      kind: "ok",
      archived: false,
      thread: { thread_id: "dur-local", state: "idle" },
    })
    expect(archived).toEqual([
      ["route-local", true, "dur-local"],
      ["route-local", false, "dur-local"],
    ])
  })

  test("#given an engine that does not know set_session_archived #when archived #then unsupported comes back as data", async () => {
    for (const archive of ["absent", "refused"] as const) {
      const { run } = remoteFixture.surface(undefined, { archive })
      expect(await run("thread_archive", { thread: "dur-local" })).toMatchObject({
        kind: "error",
        error: { code: "unsupported", details: { command: "set_session_archived" } },
      })
    }
  })

  test("#given a thread on another device #when archived #then set_session_archived goes to its session there and the result names the new state", async () => {
    const { remote, sent } = remoteFixture.account()
    const { run } = remoteFixture.surface(remote)
    expect(await run("thread_archive", { thread: "dur-on-b" })).toMatchObject({
      kind: "ok",
      archived: true,
      device: "b",
      thread: { thread_id: "dur-on-b", state: "archived", device: "b" },
    })
    expect(sent.filter((entry) => entry.rpc?.["type"] === "set_session_archived")).toEqual([
      {
        via: "session",
        device: "b",
        session: "rk-on-b",
        rpc: { type: "set_session_archived", archived: true, sessionId: "rk-on-b" },
      },
    ])
  })

  test("#given another device whose engine does not know set_session_archived #when archived #then unsupported comes back as data", async () => {
    const { remote } = remoteFixture.account({ refuse: "unknown_command" })
    const { run } = remoteFixture.surface(remote)
    expect(await run("thread_archive", { thread: "dur-on-b" })).toMatchObject({
      kind: "error",
      error: { code: "unsupported", details: { device: "b" } },
    })
  })

  test("#given the calling thread with its turn running #when it archives itself #then turn_active and nothing is sent; unarchiving it is not refused", async () => {
    const self: ThreadHostSession = {
      sessionId: "route-caller",
      durableSessionId: "dur-caller",
      cwd: process.cwd(),
      name: "me",
      status: "open",
      activity: "running",
    }
    const { run, archived } = remoteFixture.surface(undefined, { sessions: [self] })
    expect(await run("thread_archive", { thread: "self" })).toMatchObject({
      kind: "error",
      error: { code: "turn_active" },
    })
    expect(archived).toEqual([])
    expect(await run("thread_archive", { thread: "self", archived: false })).toMatchObject({ kind: "ok" })
    expect(archived).toEqual([["route-caller", false, "dur-caller"]])
  })

  test("#given a thread no engine holds #when archived #then not_resumable, and nothing is sent", async () => {
    const { run, archived } = remoteFixture.surface(undefined, { sessions: [], diskSessions: ["dur-gone"] })
    expect(await run("thread_archive", { thread: "dur-gone" })).toMatchObject({
      kind: "error",
      error: { code: "not_resumable" },
    })
    expect(archived).toEqual([])
  })
})
