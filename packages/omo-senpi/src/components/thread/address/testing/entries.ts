import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { aliasMembers } from "../../../remote/aliases"
import type { ClientCore, RemoteClient } from "../../../remote/client"
import { listingNamedDevice } from "../../../remote/client"
import { remoteFailure } from "../../../remote/codes"
import { handleOf } from "../../../remote/seams"
import { fakeClock } from "../../../remote/testing/fake-service"
import type { DeviceRow, SessionRow, SessionState } from "../../../remote/types"
import { createGatewayStore } from "../../gateway/store"
import type { RemoteSessionRow } from "../../remote/ports"
import { createThreadSdk, type ThreadSdk } from "../../sdk"
import type { ThreadHost, ThreadHostSession } from "../../tools"
import { HERE, T, ROUTE, NAMES, type createTwoDevices } from "./two-devices"

// The non-tool entries over the two-device fixture (#14305, T1a of #14943): the remote client's sessions.resolve and the
// thread SDK, each reading the same account and this device's same sessions as the fixture's thread tools.

type TwoDevices = ReturnType<typeof createTwoDevices>
export type Cleanups = (() => Promise<void> | void)[]

/** This device's live sessions and session files, as the fixture's own (unexported) HERE_SESSIONS / HERE_DISK hold them. */
const HERE_SOCKET = "/tmp/i-0123456789abcdef.sock"
export const hereSessions: readonly ThreadHostSession[] = (
  [
    [T.hereLive, ROUTE.hereLive, NAMES.hereLive],
    [T.hereShared, ROUTE.hereShared, NAMES.shared],
    [T.hereSlash, ROUTE.hereSlash, NAMES.slash],
  ] as const
).map(([durableSessionId, sessionId, name]) => ({
  sessionId,
  durableSessionId,
  cwd: process.cwd(),
  name,
  status: "open" as const,
  socket: HERE_SOCKET,
  endpoint_kind: "rpc_host" as const,
}))
export const hereDisk: readonly string[] = [T.hereEnded, T.stale]

/**
 * The remote client's sessions.resolve over the same account: the roster and listing the thread surface reads, this
 * device's own sessions merged in as the client's operator-endpoint leg merges them, and the account's alias registry.
 */
export function remoteClientOn(td: TwoDevices): ClientCore {
  const unreached = () =>
    Promise.reject(new Error("sessions.resolve reads only the roster, the listing and the aliases"))
  const roster = async (): Promise<readonly DeviceRow[]> => {
    const listed = await td.remote.client.devices.list()
    if (listed.kind === "error") throw new Error(listed.message)
    return listed.value
  }
  const hereRows = (device: DeviceRow): SessionRow[] =>
    hereSessions.map((session) => ({
      thread: handleOf(HERE.id, session.sessionId),
      durable_id: session.durableSessionId ?? "",
      name: session.name ?? "",
      title: session.name ?? "",
      device,
      project: process.cwd(),
      path: process.cwd(),
      state: "idle",
      archived: false,
      updated_ms: 1_700_000_000_000,
      source: "live",
    }))
  const rowOf = (row: RemoteSessionRow, device: DeviceRow): SessionRow => ({
    thread: handleOf(row.device, row.session_id),
    ...(row.durable_id === undefined || row.durable_id === "" ? {} : { durable_id: row.durable_id }),
    name: row.title,
    title: row.title,
    device,
    project: row.project,
    path: row.path,
    state: row.state as SessionState,
    archived: false,
    updated_ms: row.updated_ms,
    source: "live",
  })
  let client: RemoteClient | undefined
  const core: ClientCore = {
    sender: { kind: "person", uid: "user-1" },
    timers: fakeClock(),
    deps: {
      version: "5.1.70",
      ...(() => {
        const aliases = td.remote.aliases
        return aliases === undefined ? {} : { aliasRegistry: async () => aliases }
      })(),
    },
    dial: unreached,
    member: unreached,
    localSessions: unreached,
    self: () => (client ??= { aliases: aliasMembers(core) } as unknown as RemoteClient),
    devicesList: async () => ({ kind: "ok", value: await roster() }),
    sessionsList: async (filter) => {
      const devices = await roster()
      const byId = new Map(devices.map((row) => [row.id, row]))
      const listingOf = td.remote.sessions.listing
      if (listingOf === undefined) throw new Error("the two-device fixture always carries a listing")
      const listing = await listingOf()
      const wanted = filter?.device
      if (wanted !== undefined && !byId.has(wanted) && !listing.rows.some((row) => row.device === wanted))
        return remoteFailure("not_found", `No device ${wanted}.`, "Call devices.list.", {
          details: { kind: "device", id: wanted },
        })
      const deviceOf = (id: string) => byId.get(id) ?? listingNamedDevice(id)
      const rows = [
        ...(wanted === undefined || wanted === HERE.id ? hereRows(deviceOf(HERE.id)) : []),
        ...listing.rows
          .filter((row) => row.device !== HERE.id && (wanted === undefined || row.device === wanted))
          .map((row) => rowOf(row, deviceOf(row.device))),
      ]
      return { kind: "ok", value: { revision: 1, rows, unanswered: listing.incomplete.map(deviceOf) } }
    },
  }
  return core
}

/** The thread SDK on this device's host (one rpc_host socket) and session files, over the same account. */
export function sdkOn(td: TwoDevices, cleanups: Cleanups): ThreadSdk {
  const agentDir = mkdtempSync(join(tmpdir(), "surfaces-sdk-"))
  const sessionsDir = join(agentDir, "sessions", "--fixture--")
  mkdirSync(sessionsDir, { recursive: true })
  for (const id of [...hereSessions.map((session) => session.durableSessionId ?? ""), ...hereDisk])
    writeFileSync(
      join(sessionsDir, `epoch_${id}.jsonl`),
      JSON.stringify({ type: "session", id, cwd: process.cwd(), timestamp: "2026-10-02T00:00:00Z" }) + "\n",
    )
  const unused = async (): Promise<never> => {
    throw new Error("not used by locate")
  }
  const host: ThreadHost = {
    socket: "/tmp/surfaces-sdk-legacy.sock",
    listSessions: async () => [...hereSessions],
    listView: async () => ({
      sessions: [...hereSessions],
      hosts: [
        {
          socket: HERE_SOCKET,
          list_sessions: { sessions: [...hereSessions] },
          endpoint_kind: "rpc_host",
          alive: true as const,
        },
      ],
      disk: [],
    }),
    openSession: unused,
    getMessages: async () => [],
    getState: async () => ({ isStreaming: false }),
    prompt: unused,
    interrupt: async () => ({ turnId: "turn-here" }),
    setSessionName: unused,
    setModel: unused,
    getAvailableModels: unused,
    setThinkingLevel: unused,
    getAvailableThinkingLevels: unused,
    gateway: { wake: async () => ({ admitted: [] }), releaseSession: unused },
  }
  const store = createGatewayStore({ agentDir })
  const sdk = createThreadSdk({
    agentDir,
    cwd: process.cwd(),
    uid: 501,
    user: "qa-user",
    host,
    store,
    remote: td.remote,
    firstPromptWaitMs: 0,
  })
  cleanups.push(async () => {
    await sdk.dispose()
    await store.dispose()
    rmSync(agentDir, { recursive: true, force: true })
  })
  return sdk
}
