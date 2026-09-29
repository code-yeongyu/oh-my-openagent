import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { findDiskSessions } from "./address-book"
import type { ThreadToolResult } from "./contracts"
import { createInboxDrain } from "./gateway/drain"
import { createGatewayStore, type GatewayStore } from "./gateway/store"
import { FakeSessionRuntime } from "./gateway/testing/fake-runtime"
import type { GatewayDeliveryResult } from "./gateway/types"
import { createLiveThreadSurface, parseHostStatusAll } from "./live-surface"
import { createThreadSdk, type ThreadSdk } from "./sdk"
import { createThreadTools, type ThreadHost, type ThreadHostSession } from "./tools"

/**
 * A session no endpoint lists is still addressable (by id or by its `/name`) from a process that
 * never saw it alive, and a send to it is `queued_offline`, including when no endpoint of the agent
 * dir answers at all. Its row is taken exactly once when the session next starts.
 */

const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

function agentDirectory(): string {
  const agentDir = realpathSync(mkdtempSync(join(tmpdir(), "thread-offline-")))
  cleanups.push(() => rmSync(agentDir, { recursive: true, force: true }))
  return agentDir
}

/** A session file where senpi writes it: `<agentDir>/sessions/--<encoded cwd>--/<timestamp>_<id>.jsonl`. */
function sessionFile(agentDir: string, id: string, cwd: string, name?: string): string {
  const dir = join(agentDir, "sessions", `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `2026-09-29T10-00-00-000Z_${id}.jsonl`)
  const lines = [
    { type: "session", id, timestamp: "2026-09-29T10:00:00.000Z", cwd },
    { type: "message", timestamp: "2026-09-29T10:01:00.000Z", message: { role: "user", content: "an earlier turn" } },
    ...(name === undefined ? [] : [{ type: "session_info", timestamp: "2026-09-29T10:02:00.000Z", name }]),
  ]
  writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`)
  return path
}

/** What `host status --all` prints for a terminal that died: a dead `tui` row that names no session. */
function deadTerminalStatus(agentDir: string): string {
  return JSON.stringify({ endpoints: [{ socket: join(agentDir, "t-0123456789abcdef.sock"), reachable: false, endpoint_kind: "tui", alive: false, reason: "dead", owner: { pid: 99999 } }] })
}

function sdkOver(agentDir: string, host?: ThreadHost): ThreadSdk {
  const sdk = createThreadSdk({
    agentDir,
    cwd: process.cwd(),
    uid: 501,
    user: "qa-user",
    env: { HOME: agentDir },
    engineStatusAll: async () => deadTerminalStatus(agentDir),
    ...(host === undefined ? {} : { host }),
  })
  cleanups.push(() => sdk.dispose())
  return sdk
}

function storeAt(agentDir: string): GatewayStore {
  const store = createGatewayStore({ agentDir })
  cleanups.push(() => store.dispose())
  return store
}

/** One live host session that is not the target: another endpoint answers, the target's does not. */
function otherLiveHost(): ThreadHost {
  const other: ThreadHostSession = { sessionId: "rpc-1", durableSessionId: "dur-other", cwd: process.cwd(), name: "other lane", status: "open", socket: "/tmp/i-0123456789abcdef.sock", endpoint_kind: "rpc_host" }
  const unused = async (): Promise<never> => {
    throw new Error("not used")
  }
  return {
    socket: "/tmp/thread-offline-legacy.sock",
    listSessions: async () => [other],
    listView: async () => ({ sessions: [other], hosts: [{ socket: "/tmp/i-0123456789abcdef.sock", list_sessions: { sessions: [other] }, endpoint_kind: "rpc_host", alive: true }], disk: [] }),
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
    gateway: { wake: async () => ({ admitted: [] }) },
  }
}

function deliveryIdOf(result: GatewayDeliveryResult | ThreadToolResult): string {
  if (result.kind !== "ok" || !("delivery_id" in result) || typeof result.delivery_id !== "string") throw new Error(`expected a delivery, got ${JSON.stringify(result)}`)
  return result.delivery_id
}

async function within(signal: Promise<void> | undefined, what: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([signal, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`waited 5s for ${what}, it never happened`)), 5000) })])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The session starts again: its drain takes the inbox, each delivery's turn ends in order (a second
 * one waits behind the first as a follow-up), and a last inbox pass admits nothing more.
 */
async function restartAndDrain(agentDir: string, sessionPath: string, durableId: string, deliveryIds: readonly string[]): Promise<FakeSessionRuntime> {
  const store = storeAt(agentDir)
  const runtime = new FakeSessionRuntime(sessionPath, durableId, process.cwd(), { reopen: true })
  const drain = createInboxDrain({ store, runtime, durableId, sessionPath: () => sessionPath })
  cleanups.push(() => drain.stop())
  const emitted = new Map(deliveryIds.map((id) => {
    let resolve = (): void => undefined
    const written = new Promise<void>((done) => { resolve = done })
    return [id, { written, resolve }] as const
  }))
  runtime.onEmitted((id) => emitted.get(id)?.resolve())
  await drain.drain({ reason: "inbox" })
  for (const id of deliveryIds) {
    await within(emitted.get(id)?.written, `delivery ${id} to be written`)
    await drain.drain({ reason: "emitted" })
    runtime.endTurn()
    await drain.drain({ reason: "idle" })
  }
  await drain.drain({ reason: "inbox" })
  return runtime
}

describe("thread send with no live endpoint anywhere", () => {
  test("#given no endpoint of the agent dir answers #when the CLI sends to a terminal session that exited #then it is queued_offline with no endpoint, not host_unavailable", async () => {
    const agentDir = agentDirectory()
    sessionFile(agentDir, "dur-gone", process.cwd())
    const sdk = sdkOver(agentDir)
    const sent = await sdk.send({ thread: "dur-gone", text: "kept for later" })
    expect(sent).toMatchObject({ kind: "ok", delivery: { kind: "queued_offline" }, endpoint_kind: null })
    const store = storeAt(agentDir)
    expect((await store.list({ target_durable_id: "dur-gone" })).map((row) => row.state)).toEqual(["queued"])
  })

  test("#given no endpoint answers #when a session's thread_send targets an exited terminal #then the tool answers queued_offline with endpoint null", async () => {
    const agentDir = agentDirectory()
    sessionFile(agentDir, "dur-gone", process.cwd(), "gone-tui")
    const host = createLiveThreadSurface(undefined, { env: { HOME: agentDir, OMO_CODING_AGENT_DIR: agentDir }, statusAll: async () => parseHostStatusAll(deadTerminalStatus(agentDir)) })
    const tools = createThreadTools({ host, stateDirectory: agentDir, store: storeAt(agentDir), sessionsDirectory: () => join(agentDir, "sessions"), callerSessionId: () => "dur-caller", callerWorkspaceRoot: () => process.cwd() })
    const send = tools.find((tool) => tool.name === "thread_send")
    const output = await send!.execute("call-1", { thread: "gone-tui", message: "kept for later" }, undefined, undefined, { sessionManager: { getSessionId: () => "dur-caller" } } as never)
    expect(output.details.result).toMatchObject({ kind: "ok", thread_id: "dur-gone", delivery: { kind: "queued_offline" }, endpoint: null })
  })
})

describe("findDiskSessions", () => {
  test("#given sessions in the caller's workspace and in another directory #when looked up by name and by id #then a name is read only in the workspace's session directories unless all_scope, and an id is found by its file name anywhere", () => {
    const agentDir = agentDirectory()
    const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), "thread-offline-elsewhere-")))
    cleanups.push(() => rmSync(elsewhere, { recursive: true, force: true }))
    const near = sessionFile(agentDir, "dur-near", join(process.cwd(), "packages"), "lane")
    const far = sessionFile(agentDir, "dur-far", elsewhere, "lane")
    const sessions = join(agentDir, "sessions")
    const paths = (found: ReturnType<typeof findDiskSessions>) => found.map((session) => session.session_path).sort()
    expect(paths(findDiskSessions(sessions, "LANE", { workspaceRoots: [process.cwd()] }))).toEqual([near])
    expect(paths(findDiskSessions(sessions, "lane", { all_scope: true }))).toEqual([far, near].sort())
    expect(findDiskSessions(sessions, "dur-far", { workspaceRoots: [process.cwd()] })).toMatchObject([{ durable_id: "dur-far", cwd: elsewhere, name: "lane", source_host: null }])
    expect(findDiskSessions(join(agentDir, "missing"), "lane", { all_scope: true })).toEqual([])
  })
})

describe("thread send to a session this process never saw alive", () => {
  test("#given a dead terminal known only from its session file #when a fresh process sends by id and by name #then both are queued_offline, and the restarted session applies each exactly once", async () => {
    const agentDir = agentDirectory()
    const path = sessionFile(agentDir, "dur-dead", process.cwd(), "dead-tui")
    const sdk = sdkOver(agentDir, otherLiveHost())
    const byId = await sdk.send({ thread: "dur-dead", text: "by id" })
    const byName = await sdk.send({ thread: "dead-tui", text: "by name" })
    expect(byId).toMatchObject({ kind: "ok", thread_id: "dur-dead", delivery: { kind: "queued_offline" }, endpoint_kind: null })
    expect(byName).toMatchObject({ kind: "ok", thread_id: "dur-dead", delivery: { kind: "queued_offline" }, endpoint_kind: null })
    const ids = [deliveryIdOf(byId), deliveryIdOf(byName)]

    const runtime = await restartAndDrain(agentDir, path, "dur-dead", ids)
    expect(ids.map((id) => runtime.transcriptEntries(id))).toEqual([1, 1])
    const store = storeAt(agentDir)
    expect((await store.list({ target_durable_id: "dur-dead" })).map((row) => row.state)).toEqual(["applied", "applied"])
  })

  test("#given a thread_send tool in a fresh session #when it targets a dead terminal by its name #then it is queued_offline", async () => {
    const agentDir = agentDirectory()
    sessionFile(agentDir, "dur-dead", process.cwd(), "dead-tui")
    const tools = createThreadTools({ host: otherLiveHost(), stateDirectory: agentDir, store: storeAt(agentDir), sessionsDirectory: () => join(agentDir, "sessions"), callerSessionId: () => "dur-other", callerWorkspaceRoot: () => process.cwd() })
    const send = tools.find((tool) => tool.name === "thread_send")
    const output = await send!.execute("call-1", { thread: "dead-tui", message: "hello" }, undefined, undefined, { sessionManager: { getSessionId: () => "dur-other" } } as never)
    expect(output.details.result).toMatchObject({ kind: "ok", thread_id: "dur-dead", delivery: { kind: "queued_offline" }, endpoint: null })
  })

  test("#given session files on disk #when the address is an unknown id, a name two sessions share, or a name only another workspace holds #then not_found, ambiguous_target, and not_found unless all_scope, with nothing written", async () => {
    const agentDir = agentDirectory()
    const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), "thread-offline-elsewhere-")))
    cleanups.push(() => rmSync(elsewhere, { recursive: true, force: true }))
    sessionFile(agentDir, "dur-twin-a", process.cwd(), "twin")
    sessionFile(agentDir, "dur-twin-b", process.cwd(), "twin")
    sessionFile(agentDir, "dur-far", elsewhere, "far-lane")
    const sdk = sdkOver(agentDir, otherLiveHost())
    expect(await sdk.send({ thread: "dur-nobody", text: "x" })).toMatchObject({ kind: "error", error: { code: "not_found" } })
    expect(await sdk.send({ thread: "twin", text: "x" })).toMatchObject({ kind: "error", error: { code: "ambiguous_target" } })
    expect(await sdk.send({ thread: "far-lane", text: "x" })).toMatchObject({ kind: "error", error: { code: "not_found" } })
    const store = storeAt(agentDir)
    expect(await store.list()).toEqual([])
    expect(await sdk.send({ thread: "far-lane", text: "x", all_scope: true })).toMatchObject({ kind: "ok", thread_id: "dur-far", delivery: { kind: "queued_offline" } })
  })
})
