import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseAddress } from "@oh-my-opencode/thread-address-core"
import { aliasMembers } from "../../remote/aliases"
import type { ClientCore, RemoteClient } from "../../remote/client"
import { listingNamedDevice } from "../../remote/client"
import { remoteFailure } from "../../remote/codes"
import { resolveTypedAddress } from "../../remote/device-address"
import { resolveMember } from "../../remote/resolve"
import { handleOf } from "../../remote/seams"
import { fakeClock } from "../../remote/testing/fake-service"
import type { DeviceRow, SessionRow, SessionState } from "../../remote/types"
import { createGatewayStore } from "../gateway/store"
import type { RemoteSessionRow } from "../remote/ports"
import { createThreadSdk, type ThreadSdk } from "../sdk"
import type { ThreadHost, ThreadHostSession } from "../tools"
import { ALIAS, B, createTwoDevices, HERE, KEY, NAMES, ROUTE, T, type TwoDeviceOptions } from "./testing/two-devices"

// #14305 AC1/AC2: ONE table over the two-device fixture, run through every surface that reads a typed thread address -
// the thread tools (thread_send), the monitor target, the remote client's sessions.resolve, omo remote's typed address
// and the thread SDK. Each row is an address form (or a miss) and the one outcome every surface must give it: the same
// thread on the same device, or the same refusal code.

type TwoDevices = ReturnType<typeof createTwoDevices>
type Outcome = { readonly thread: string; readonly device: string } | { readonly code: string }
type Surface = (td: TwoDevices, address: string) => Promise<Outcome>

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

/** This device's live sessions and session files, as the fixture's own (unexported) HERE_SESSIONS / HERE_DISK hold them. */
const HERE_SOCKET = "/tmp/i-0123456789abcdef.sock"
const hereSessions: readonly ThreadHostSession[] = (
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
const hereDisk: readonly string[] = [T.hereEnded, T.stale]

const threadTools: Surface = async (td, address) => {
  const result = (await td.run("thread_send", { thread: address, message: "x" })) as {
    kind: string
    thread?: string
    device?: string
    error?: { code: string }
  }
  return result.kind === "ok"
    ? { thread: result.thread ?? "", device: result.device ?? HERE.id }
    : { code: result.error?.code ?? result.kind }
}

const monitor: Surface = async (td, address) => {
  const armed = await td.tools.monitorTarget(address)
  if (armed.kind === "refused") return { code: armed.failure.code }
  const target = armed.kind === "target" ? armed.target : address
  const parsed = parseAddress(target)
  return parsed.kind === "device"
    ? { thread: parsed.thread, device: parsed.device }
    : { thread: target, device: HERE.id }
}

/**
 * The remote client's sessions.resolve over the same account: the roster and listing the thread surface reads, this
 * device's own sessions merged in as the client's operator-endpoint leg merges them, and the account's alias registry.
 */
function remoteClientOn(td: TwoDevices): ClientCore {
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
    onClose: () => undefined,
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

const sessionsResolve: Surface = async (td, address) => {
  const resolved = await resolveMember(remoteClientOn(td))(address)
  return resolved.kind === "ok"
    ? { thread: resolved.value.durable_id ?? "", device: resolved.value.device.id }
    : { code: resolved.code }
}

const omoRemote: Surface = async (td, address) => {
  const resolved = await resolveTypedAddress(td.remote, address, { need: "online" })
  return resolved.kind === "ok"
    ? { thread: resolved.thread, device: resolved.where.row.device }
    : { code: resolved.error.code }
}

/** The thread SDK on this device's host (one rpc_host socket) and session files, over the same account. */
function sdkOn(td: TwoDevices): ThreadSdk {
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
    interrupt: unused,
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

const threadSdk: Surface = async (td, address) => {
  const located = await sdkOn(td).locate({ thread: address })
  if (located.kind !== "ok") return { code: located.error.code }
  const thread = located.thread as { thread_id: string; device?: string }
  return { thread: thread.thread_id, device: thread.device ?? HERE.id }
}

const SURFACES: readonly (readonly [string, Surface])[] = [
  ["thread tools (thread_send)", threadTools],
  ["monitor target", monitor],
  ["remote client sessions.resolve", sessionsResolve],
  ["omo remote", omoRemote],
  ["thread SDK (locate)", threadSdk],
]

const ON_B = { thread: T.bLive, device: B.id } as const

/** One address form or miss, the fixture state it is read in, and the one outcome every surface gives it. */
type Row = {
  readonly form: string
  readonly address: string
  readonly setup?: TwoDeviceOptions
  readonly want: Outcome
}

const ROWS: readonly Row[] = [
  { form: "<device name>/<thread id>", address: `${B.name}/${T.bLive}`, want: ON_B },
  { form: "<device id prefix>/<thread id prefix>", address: `${B.id.slice(0, 6)}/${T.bLive.slice(0, 8)}`, want: ON_B },
  { form: "<device id>/<thread name>", address: `${B.id}/${NAMES.bLive}`, want: ON_B },
  { form: "<device name>/<listing key>", address: `${B.name}/${KEY.bLive}`, want: ON_B },
  { form: "bare thread id", address: T.bLive, want: ON_B },
  { form: "account alias", address: ALIAS.onB, want: ON_B },
  { form: "unique thread name", address: NAMES.bLive, want: ON_B },
  { form: "8+ hex thread id prefix", address: T.bLive.slice(0, 8), want: ON_B },
  {
    form: "ambiguous: a device name two online devices share",
    address: `${B.name}/${T.bLive}`,
    setup: { twin: true },
    want: { code: "ambiguous_target" },
  },
  {
    form: "offline device: a thread part its rows do not hold",
    address: `${B.name}/no-such-thread`,
    setup: { bOffline: true },
    want: { code: "device_offline" },
  },
  {
    form: "unanswered device: a bare name only it holds",
    address: NAMES.bLive,
    setup: { incomplete: true },
    want: { code: "host_unavailable" },
  },
  {
    form: "unanswered device: <device name>/<thread name>",
    address: `${B.name}/${NAMES.bLive}`,
    setup: { incomplete: true },
    want: { code: "host_unavailable" },
  },
  { form: "nowhere: a thread id no device holds", address: T.nowhere, want: { code: "not_found" } },
  { form: "nowhere: a name no device holds", address: "no-such-thread", want: { code: "not_found" } },
]

describe("#14305: one address table through every surface", () => {
  test.each(ROWS.flatMap((row) => SURFACES.map(([surface, read]) => [row.form, surface, row, read] as const)))(
    "#given %s #when %s reads it #then it answers the table's outcome",
    async (_form, _surface, row, read) => {
      const td = createTwoDevices(row.setup)
      cleanups.push(td.cleanup)
      expect(await read(td, row.address)).toEqual(row.want)
    },
  )
})
