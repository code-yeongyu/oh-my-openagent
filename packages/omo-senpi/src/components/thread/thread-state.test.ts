import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { readDiskSession } from "./address-book"
import type { ThreadToolResult } from "./contracts"
import { createGatewayStore, type GatewayStore } from "./gateway/store"
import type { RemoteSessionRow } from "./remote/ports"
import { B_ROW, createRemoteThreadFixture } from "./thread-remote-fixture"
import { createThreadTools } from "./tools"
import { listAcross } from "./remote/cross-device"
import { listThreads } from "./tools/read-ops"
import { threadState } from "./tools/thread-state"
import type { ThreadHost, ThreadHostSession, ThreadHostView, ThreadToolSurfaceOptions } from "./tools/ports"

// A thread's state is one of running | idle | inactive | archived (#13403, #13407, #13411): `online` is a device's,
// never a thread's, so no row carries `alive`.

describe("threadState is the one state rule (thread_list and local control both derive from it)", () => {
  test("#given a mid-turn activity #when the state is derived #then running, queued and awaiting_approval are all running", () => {
    for (const activity of ["running", "queued", "awaiting_approval"])
      expect(threadState({ held: true, activity })).toBe("running")
    expect(threadState({ held: true, activity: "errored" })).toBe("idle")
    expect(threadState({ held: true })).toBe("idle")
    expect(threadState({ held: false, activity: "queued" })).toBe("inactive")
    expect(threadState({ archived: true, held: true, activity: "running" })).toBe("archived")
  })
})

const directories: string[] = []
const stores: GatewayStore[] = []
const remoteFixture = createRemoteThreadFixture()

// A store holds its database open in a worker until disposed; Windows refuses to remove a directory with an open
// file in it (EBUSY), so every store closes before its scratch directory goes.
function gatewayStore(agentDir: string): GatewayStore {
  const store = createGatewayStore({ agentDir })
  stores.push(store)
  return store
}

afterEach(async () => {
  await remoteFixture.cleanup()
  await Promise.all(stores.splice(0).map((store) => store.dispose()))
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
    store: gatewayStore(directory),
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

type Row = { readonly thread: string; readonly state?: string; readonly status?: string; readonly model?: unknown }

function rows(result: ThreadToolResult): readonly Row[] {
  if (result.kind !== "ok" || !("threads" in result)) throw new Error(`not a list: ${JSON.stringify(result)}`)
  return result.threads as readonly Row[]
}

const table = (result: ThreadToolResult) =>
  Object.fromEntries(
    rows(result).map((row) => [row.thread, { state: row.state, status: row.status, model: row.model ?? null }]),
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

  test("#given more session files than one listing reads, one of the unread threads live #when listed #then the result counts the inactive threads it left out, never the live one, and a filter without inactive counts none (#14295)", async () => {
    const directory = scratch()
    const sessionsDirectory = join(directory, "sessions")
    const project = join(sessionsDirectory, "--work--")
    mkdirSync(project, { recursive: true })
    const ids: string[] = []
    for (let index = 0; index < 203; index += 1) {
      const id = `0195f0c2-1a2b-7c3d-8e4f-${index.toString(16).padStart(12, "0")}`
      const created = new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString()
      const file = join(project, `${created.replace(/[:.]/g, "-")}_${id}.jsonl`)
      writeFileSync(file, `${JSON.stringify({ type: "session", id, cwd: "/work", timestamp: created })}\n`)
      // The listing reads the newest by modification time: older files are touched earlier.
      utimesSync(file, 1_800_000_000 + index, 1_800_000_000 + index)
      ids.push(id)
    }
    // The three oldest files are left unread; the oldest of them runs on this device's endpoint.
    const running: ThreadHostSession = {
      sessionId: "route-old",
      durableSessionId: ids[0] ?? "",
      cwd: "/work",
      status: "open",
      activity: "running",
    }
    const options = { ...surfaceOptions(directory), sessionsDirectory: () => sessionsDirectory }
    const view: ThreadHostView = { sessions: [running], hosts: [], disk: [] }
    expect(listThreads(options, view, true)).toMatchObject({ inactive_truncated: true, inactive_dropped: 2 })
    expect(rows(listThreads(options, view, true)).map((row) => row.thread)).toContain(ids[0])
    expect(listThreads(options, view, true, ["running", "idle"])).not.toHaveProperty("inactive_dropped")
    // An unread file may be archived: a listing of archived threads is as partial as one of inactive threads.
    expect(listThreads(options, view, true, ["archived"])).toMatchObject({
      inactive_truncated: true,
      inactive_dropped: 2,
    })
    // With an account, the count is this device's own: its device row carries it.
    const across = await listAcross(remoteFixture.account({}).remote, listThreads(options, view, true), true)
    const devices = across.kind === "ok" && "devices" in across ? (across.devices ?? []) : []
    expect(devices.find((device) => device.this_device)).toMatchObject({ device: "here", dropped: 2 })
    expect(devices.filter((device) => !device.this_device).every((device) => device.dropped === undefined)).toBe(true)
  })

  test("#given an engine endpoint of this device that did not answer the listing in time #when listed #then the result and this device's row say the listing is incomplete, while a listing whose only failed endpoint is known dead stays complete (#14308)", async () => {
    const directory = scratch()
    const live = "/tmp/thread-state-14308-live.sock"
    const slow = "/tmp/thread-state-14308-slow.sock"
    const dead = "/tmp/thread-state-14308-dead.sock"
    const running: ThreadHostSession = {
      sessionId: "r1",
      durableSessionId: "t-running",
      cwd: directory,
      status: "open",
      activity: "running",
      socket: live,
    }
    const answered = {
      socket: live,
      endpoint_kind: "rpc_host" as const,
      alive: true,
      list_sessions: { sessions: [running] },
    }
    const view = (failed: ThreadHostView["hosts"]): ThreadHostView => ({
      sessions: [running],
      hosts: [answered, ...failed],
      disk: [],
    })
    const timedOut = {
      socket: slow,
      endpoint_kind: "rpc_host" as const,
      alive: false,
      reason: "live_unresponsive" as const,
      error: "thread RPC request timed out",
    }
    const gone = { socket: dead, endpoint_kind: "tui" as const, alive: false, reason: "dead" as const, error: "dead" }
    const options = surfaceOptions(directory)

    const partial = listThreads(options, view([timedOut, gone]), true)
    expect(partial).toMatchObject({ listing: "incomplete", unanswered_endpoints: 1 })
    const across = await listAcross(remoteFixture.account({}).remote, partial, true)
    const devices = across.kind === "ok" && "devices" in across ? (across.devices ?? []) : []
    expect(devices.find((device) => device.this_device)?.listing).toBe("incomplete")

    const complete = listThreads(options, view([gone]), true)
    expect(complete).not.toHaveProperty("listing")
    expect(complete).not.toHaveProperty("unanswered_endpoints")
  })

  test("#given the same rows #when listed by default #then archived threads are hidden; state archived shows only them", () => {
    const directory = scratch()
    const options = surfaceOptions(directory)
    const listed = rows(listThreads(options, localView(directory), true)).map((row) => row.thread)
    expect(listed.sort()).toEqual(["d-plain", "d-unarchived", "l-closed", "l-idle", "l-older-engine", "l-running"])
    const archived = rows(listThreads(options, localView(directory), true, ["archived"])).map((row) => row.thread)
    expect(archived.sort()).toEqual(["d-archived", "l-archived"])
  })

  test("#given live and degraded rows #when listed #then no row carries alive or the raw archived field, and only a held thread carries activity", () => {
    const directory = scratch()
    const result = listThreads(surfaceOptions(directory), localView(directory), true, [
      "running",
      "idle",
      "inactive",
      "archived",
    ])
    for (const row of rows(result)) {
      expect(row).not.toHaveProperty("alive")
      expect(row).not.toHaveProperty("archived")
      if (row.state === "inactive" || row.state === "archived") expect(row).not.toHaveProperty("activity")
    }
  })

  test("#given an engine reporting senpi#6688's activity detail #when listed #then each held row carries it, state folds it, and error_code rides only with errored", () => {
    const cases = [
      { id: "a-running", activity: "running", turn_id: "4", state: "running" },
      { id: "a-queued", activity: "queued", turn_id: "5", state: "running" },
      { id: "a-approval", activity: "awaiting_approval", turn_id: "6", state: "running" },
      { id: "a-errored", activity: "errored", error_code: "rate_limit", turn_id: "7", state: "idle" },
      { id: "a-idle", activity: "idle", error_code: "ignored", state: "idle" },
    ] as const
    const expected: Record<string, unknown> = {}
    const sessions: ThreadHostSession[] = cases.map((entry) => {
      expected[entry.id] = {
        state: entry.state,
        activity: entry.activity,
        ...(entry.activity === "errored" ? { error_code: "rate_limit" } : {}),
        ...("turn_id" in entry ? { turn_id: entry.turn_id } : {}),
      }
      return {
        sessionId: entry.id,
        durableSessionId: entry.id,
        cwd: "/w",
        name: entry.id,
        status: "open" as const,
        activity: entry.activity,
        ...("error_code" in entry ? { error_code: entry.error_code } : {}),
        ...("turn_id" in entry ? { turn_id: entry.turn_id } : {}),
      }
    })
    const directory = scratch()
    const result = listThreads(surfaceOptions(directory), { sessions, hosts: [], disk: [] }, true, ["running", "idle"])
    const seen: Record<string, unknown> = {}
    for (const row of rows(result)) {
      const detail = row as { state: string; activity?: string; error_code?: string; turn_id?: string }
      seen[row.thread] = {
        state: detail.state,
        activity: detail.activity,
        ...(detail.error_code === undefined ? {} : { error_code: detail.error_code }),
        ...(detail.turn_id === undefined ? {} : { turn_id: detail.turn_id }),
      }
    }
    expect(seen).toEqual(expected)
  })

  test("#given an engine publishing senpi#7025's retry wait on list_sessions #when listed #then a running thread sleeping in a backoff carries waiting_on retry with its kind, until and attempts, and no other row carries one (#14278)", () => {
    const until = "2026-11-19T05:00:45.000Z"
    const wait = (kind: string) => ({ kind, attempt: 2, maxAttempts: 5, delayMs: 45_000, until, error: "429 too many" })
    const row = (id: string, fields: Record<string, unknown>): ThreadHostSession =>
      ({ sessionId: id, durableSessionId: id, cwd: "/w", name: id, status: "open", ...fields }) as ThreadHostSession
    const sessions = [
      row("rate-limited", { activity: "running", waiting: wait("rate_limit") }),
      row("retrying", { activity: "running", waiting: wait("retry") }),
      row("working", { activity: "running" }),
      // A wait on a thread that is not running, or one of a shape this build does not know, is not a wait.
      row("idle-stale", { activity: "idle", waiting: wait("rate_limit") }),
      row("unknown-kind", { activity: "running", waiting: wait("quota") }),
      row("closed", { status: "closed", activity: "running", waiting: wait("rate_limit") }),
    ]
    const result = listThreads(surfaceOptions(scratch()), { sessions, hosts: [], disk: [] }, true, [
      "running",
      "idle",
      "inactive",
    ])
    const waits = Object.fromEntries(
      rows(result).map((listed) => [listed.thread, (listed as { waiting_on?: unknown }).waiting_on ?? null]),
    )
    expect(waits).toEqual({
      "rate-limited": { kind: "retry", reason: "rate_limit", until, attempt: 2, max_attempts: 5 },
      retrying: { kind: "retry", reason: "retry", until, attempt: 2, max_attempts: 5 },
      working: null,
      "idle-stale": null,
      "unknown-kind": null,
      closed: null,
    })
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
        .map((row) => row.thread)
        .sort(),
    ).toEqual(["r-ended", "r-idle", "r-running"])
    expect(plain).toMatchObject({ devices: [{ device: "here" }, { device: "b", threads: 3 }] })
    const archived = await run("thread_list", { state: ["archived"] })
    expect(
      rows(archived)
        .map((row) => row.thread)
        .sort(),
    ).toEqual(["r-archived", "r-archived-ended"])
    const some = await run("thread_list", { state: ["running", "inactive"] })
    expect(
      rows(some)
        .map((row) => row.thread)
        .sort(),
    ).toEqual(["r-ended", "r-running"])
  })

  test("#given an offline device's cached rows (measured: 7 of an offline device's 90 rows read running) #when listed #then none reads running or idle, each carries as_of, and archived still wins", async () => {
    const asOf = Date.UTC(2026, 10, 14, 9, 0, 0)
    const cached = REMOTE_ROWS.map((row) => ({ ...row, source: "cache" as const, as_of: asOf }))
    const { remote } = remoteFixture.account({ rows: cached })
    const { run } = remoteFixture.surface(remote, { sessions: [] })
    const result = await run("thread_list", { state: ["running", "idle", "inactive", "archived"] })
    expect(table(result)).toMatchObject({
      "r-running": { state: "inactive", status: "resumable" },
      "r-idle": { state: "inactive", status: "resumable" },
      "r-ended": { state: "inactive" },
      "r-archived": { state: "archived" },
    })
    for (const row of rows(result)) expect(row).toMatchObject({ as_of: new Date(asOf).toISOString() })
  })

  test("#given one device whose rows come from two holders (rows 6 wait, rows 7 version) #when listed #then each row keeps its own holder's version, only a running row carries the wait, and a field the row lacks stays absent (#14278)", async () => {
    const until = "2026-11-20T09:00:45.000Z"
    const wait = { kind: "rate_limit", attempt: 2, maxAttempts: 5, delayMs: 45_000, until }
    const holders: RemoteSessionRow[] = [
      remoteRow("h1-waiting", { state: "running", engine_version: "2026.11.19-3", waiting: wait }),
      remoteRow("h1-idle", { state: "idle", engine_version: "2026.11.19-3" }),
      remoteRow("h2-running", { state: "running", engine_version: "5.1.70" }),
      // An older holder, or a host below rows 6/7: nothing is inferred from the device or a sibling row.
      remoteRow("unknown-holder", { state: "running" }),
      // A cached snapshot names no live holder: neither field is shown.
      remoteRow("cached", { state: "running", source: "cache", as_of: 1, engine_version: "5.1.70", waiting: wait }),
      // A malformed version is no version.
      remoteRow("bad-version", { state: "idle", engine_version: "x".repeat(129) }),
    ]
    const { remote } = remoteFixture.account({ rows: holders })
    const { run } = remoteFixture.surface(remote, { sessions: [] })
    const listed = rows(await run("thread_list", { state: ["running", "idle", "inactive"] }))
    const seen = Object.fromEntries(
      listed.map((row) => {
        const fields = row as { engine_version?: string; waiting_on?: unknown }
        return [row.thread, { engine_version: fields.engine_version ?? null, waiting_on: fields.waiting_on ?? null }]
      }),
    )
    expect(seen).toEqual({
      "h1-waiting": {
        engine_version: "2026.11.19-3",
        waiting_on: { kind: "retry", reason: "rate_limit", until, attempt: 2, max_attempts: 5 },
      },
      "h1-idle": { engine_version: "2026.11.19-3", waiting_on: null },
      "h2-running": { engine_version: "5.1.70", waiting_on: null },
      "unknown-holder": { engine_version: null, waiting_on: null },
      cached: { engine_version: null, waiting_on: null },
      "bad-version": { engine_version: null, waiting_on: null },
    })
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

describe("thread_list follows the account's device list (#13505)", () => {
  const asOf = Date.UTC(2026, 10, 14, 9, 0, 0)
  const every = ["running", "idle", "inactive", "archived"]
  // b is offline but still in the account's list; c was removed from it, while the listing still carries c's cached rows.
  const listing = [
    ...REMOTE_ROWS.map((row) => ({ ...row, source: "cache" as const, as_of: asOf })),
    remoteRow("c-cached", { device: "c", state: "running", source: "cache", as_of: asOf }),
  ]
  const listed = (result: ThreadToolResult) =>
    rows(result)
      .map((row) => row.thread)
      .sort()

  test("#given a device removed from the account whose cached rows the listing still carries #when listed and addressed #then its rows are dropped, an offline device keeps its rows, and nothing is sent to the removed one", async () => {
    const kept = REMOTE_ROWS.map((row) => row.title).sort()
    const account = remoteFixture.account({ rows: listing, online: false, removed: ["c"] })
    const { run } = remoteFixture.surface(account.remote, { sessions: [] })
    const result = await run("thread_list", { state: every })
    expect(listed(result)).toEqual(kept)
    for (const row of rows(result)) {
      expect(row.state).not.toBe("running")
      expect(row).toMatchObject({ as_of: new Date(asOf).toISOString() })
    }
    expect(result.kind === "ok" && "devices" in result && result.devices).toEqual([
      expect.objectContaining({ device: "here", threads: 0 }),
      expect.objectContaining({ device: "b", online: false, listing: "offline", threads: kept.length }),
    ])
    expect(await run("thread_create", { thread: "c-cached" })).toMatchObject({
      kind: "error",
      error: { code: "not_found" },
    })
    expect(account.sent.filter((entry) => entry.device === "c")).toEqual([])
  })

  test("#given the account device list cannot be read #when listed #then no row is judged and remote_unavailable says so", async () => {
    const unread = remoteFixture.account({ rows: listing, online: false, removed: ["c"], devicesFail: true })
    const fallback = await remoteFixture.surface(unread.remote, { sessions: [] }).run("thread_list", { state: every })
    expect(listed(fallback)).toEqual([...REMOTE_ROWS.map((row) => row.title), "c-cached"].sort())
    expect(fallback).toMatchObject({ remote_unavailable: "devices_unavailable" })
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
        return { outcome: "closed", dropped_deliveries: [] }
      },
    }
    const tools = createThreadTools({
      host,
      store: gatewayStore(scratch()),
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
    const open = sessions[0]
    if (open === undefined) throw new Error("missing fixture session")
    sessions[0] = { ...open, status: "opening" }
    expect(rows(await run("thread_list", {}))).toEqual([
      expect.objectContaining({ thread: "dur-a", state: "opening", status: "live" }),
    ])
    expect(rows(await run("thread_list", { state: ["idle"] }))).toEqual([])
    expect(rows(await run("thread_list", { state: ["opening"] }))).toHaveLength(1)
    expect(await run("thread_close", { thread: "dur-a" })).toMatchObject({
      kind: "error",
      error: { code: "host_unavailable", details: { reason: "session_opening" } },
    })
    expect(sessions).toHaveLength(1)
    sessions[0] = open
    expect(table(await run("thread_list", {}))).toEqual({ "dur-a": { state: "idle", status: "live", model: null } })
    expect(await run("thread_close", { thread: "dur-a" })).toMatchObject({ kind: "ok", closed: true })
    for (const scope of [{}, { all_scope: true }])
      expect(rows(await run("thread_list", scope))).toEqual([
        expect.objectContaining({ thread: "dur-a", state: "inactive", status: "resumable", name: "plan the move" }),
      ])
    const read = await run("thread_read", { thread: "dur-a" })
    expect(read).toMatchObject({ kind: "ok", thread: "dur-a", source: "session_jsonl" })
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
      thread: "dur-local",
      state: "archived",
      name: "local peer",
    })
    expect(await run("thread_archive", { thread: "dur-local", archived: false })).toMatchObject({
      kind: "ok",
      archived: false,
      thread: "dur-local",
      state: "idle",
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
      thread: "dur-on-b",
      state: "archived",
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
