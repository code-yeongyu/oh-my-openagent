import { existsSync } from "node:fs"
import { hostname } from "node:os"
import {
  connectDeviceService,
  deviceServiceEndpointPath,
  deviceServiceStateDir,
  realTimers,
  type ControlSessionWakeState as WakeState,
  type DeviceService,
  type DeviceRow as WireDeviceRow,
  type RemoteAttach,
  type ListingRow,
  type Timers,
} from "@oh-my-opencode/device-service-core/device-service"
import type { AliasRegistry } from "../thread/remote/ports"
import type { ThreadSocketConnect } from "../thread/live-surface"
import type { ThreadHost } from "../thread/tools/ports"
import { aliasMembers } from "./aliases"
import { attachMember } from "./attach"
import { failureFromError, nextActionFor, remoteFailure } from "./codes"
import { BOUNDS, CONNECT_SLACK_MS, DEADLINES, withinDeadline } from "./deadlines"
import { streamMembers } from "./follow"
import { resolveMember } from "./resolve"
import { handleOf } from "./seams"
import { sessionMembers } from "./sessions"
import { defaultLocalThreadHost } from "./sessions-local"
import { localSessionRows } from "./sessions-local-list"
import type {
  AttachHandle,
  BootstrapResult,
  BootstrapSetup,
  ControlState,
  DeviceRow,
  FollowEvent,
  InterruptResult,
  OpenRequest,
  OpenResult,
  Opts,
  R,
  ReadPage,
  RemoteFailure,
  RemoteSender,
  RemoteStream,
  Scope,
  SendReceipt,
  SendRequest,
  ServiceInfo,
  ServiceStatus,
  SessionDetail,
  SessionRow,
  SessionsList,
  SessionsListFilter,
  ThreadHandle,
  WaitResult,
} from "./types"

export type RemoteClientDeps = {
  readonly version: string
  readonly stateDir?: string
  /** The clock seam: every deadline of the client and of its connection runs on it (real timers by default). */
  readonly timers?: Timers
  /** Runs the device service bootstrap for `service.bootstrap`; the internal bootstrap entry provides it (part 4c-3). */
  readonly bootstrap?: (setup: BootstrapSetup) => Promise<BootstrapResult>
  /**
   * The account's alias registry for `aliases.*`. The caller builds it (it needs the account service access, which the
   * client must not import); absent, the alias members answer `unsupported{feature:"aliases"}`.
   */
  readonly aliasRegistry?: () => Promise<AliasRegistry>
  /**
   * Where the gateway store's worker sidecar is (`gateway-store-worker.mjs` beside the plugin's extension bundle). The
   * compiled binary passes its provisioned runtime's copy; from source the store resolves its own worker.
   */
  readonly gatewayWorkerUrl?: URL
  /**
   * Serves an attach as a local engine endpoint (`AttachHandle.serveEndpoint`): the caller hands in omo-native's
   * `serveRemoteAttach`, so the client never imports a net server into `omo remote`'s local-only graph (#13440). Absent,
   * `serveEndpoint` answers `unsupported{feature:"serve_endpoint"}`.
   */
  readonly serveAttach?: (
    attach: RemoteAttach,
    label: string,
  ) => Promise<{ readonly socketPath: string; readonly sessionRef: string; readonly close: () => Promise<void> }>
  /**
   * The approval mode of the session this client acts for (a session or connector sender): an open may keep or narrow
   * it, never widen it. Absent, only the narrowest mode passes.
   */
  readonly permissionPreset?: () => string | undefined
  /**
   * Test seam: this device's operator endpoint, where an open on this device lands (the engine's own host by default),
   * built over the socket `connect` the open watches its frames on.
   */
  readonly localThreadHost?: (connect: ThreadSocketConnect) => Promise<ThreadHost>
  /** Test seam: opens the proven device-service connection (`connectDeviceService` by default). */
  readonly connect?: (options: {
    readonly version: string
    readonly stateDir: string
    readonly timers: Timers
  }) => Promise<DeviceService>
}

/**
 * The one remote client (design v8-core r2, B1, with the #13414 W3 rows' shapes). Members of 4a-1 live in this file; each
 * later member lives in its own module (sessions.ts, follow.ts, attach.ts, aliases.ts, resolve.ts) and is built from the
 * same `ClientCore`, so every member shares the one connection, the sender and the deadlines.
 */
export type RemoteClient = {
  readonly service: {
    readonly info: (opts?: Opts) => R<ServiceInfo>
    readonly status: (opts?: Opts) => R<ServiceStatus>
    readonly setEnabled: (on: boolean, opts?: Opts) => R<{ readonly enabled: boolean }>
    readonly control: (opts?: Opts) => R<ControlState>
    readonly setControl: (on: boolean, opts?: Opts) => R<ControlState>
    readonly bootstrap: (setup: BootstrapSetup, opts?: Opts) => R<BootstrapResult>
    /** The device's session-wake switch (omo#13037 A7.2.5); `unsupported{feature:"wake"}` below the service that carries it. */
    readonly wake: (opts?: Opts) => R<WakeState>
    /** Sets the switch; `null` removes the stored value (the default applies). Person only. */
    readonly setWake: (on: boolean | null, opts?: Opts) => R<WakeState>
  }
  readonly devices: {
    readonly list: (opts?: Opts) => R<readonly DeviceRow[]>
    readonly resolve: (idOrName: string, opts?: Opts) => R<DeviceRow>
  }
  readonly sessions: {
    readonly list: (filter?: SessionsListFilter, opts?: Opts) => R<SessionsList>
    /** One address (durable id, alias, name, `<device>/<session>`) to its row, on the cached listing (no relist per op). */
    readonly resolve: (address: string, scope?: Scope, opts?: Opts) => R<SessionRow>
    readonly get: (thread: ThreadHandle, opts?: Opts) => R<SessionDetail>
    readonly open: (request: OpenRequest, opts?: Opts) => R<OpenResult>
    readonly send: (thread: ThreadHandle, request: SendRequest, opts?: Opts) => R<SendReceipt>
    readonly read: (
      thread: ThreadHandle,
      page?: { readonly before?: string; readonly tail?: number },
      opts?: Opts,
    ) => R<ReadPage>
    /** Status changes, turn ends and the turn's stream, from now on; survives relay, service and engine restarts. */
    readonly follow: (thread: ThreadHandle, opts?: Opts) => RemoteStream<FollowEvent>
    readonly wait: (thread: ThreadHandle, opts?: Opts) => R<WaitResult>
    readonly interrupt: (thread: ThreadHandle, opts?: Opts) => R<InterruptResult>
    /** The session's own model ("provider/id"); never a device default. */
    readonly setModel: (thread: ThreadHandle, model: string, opts?: Opts) => R<{ readonly model: string }>
    /** The session's own thinking level; never a device default. */
    readonly setReasoning: (thread: ThreadHandle, level: string, opts?: Opts) => R<{ readonly reasoning: string }>
    readonly close: (thread: ThreadHandle, opts?: Opts) => R<{ readonly closed: boolean }>
    readonly archive: (thread: ThreadHandle, archived: boolean, opts?: Opts) => R<{ readonly archived: boolean }>
  }
  /** One session's live attach: its snapshot, records, pending UI requests and their answers. */
  readonly attach: (thread: ThreadHandle, opts?: Opts) => R<AttachHandle>
  readonly aliases: {
    readonly resolve: (alias: string, opts?: Opts) => R<ThreadHandle>
    readonly set: (thread: ThreadHandle, alias: string, opts?: Opts) => R<{ readonly alias: string }>
    readonly clear: (thread: ThreadHandle, opts?: Opts) => R<{ readonly released: boolean }>
  }
  readonly close: () => void
}

export type Outcome<T> = { readonly kind: "ok"; readonly value: T } | RemoteFailure
export const ok = <T>(value: T): Outcome<T> => ({ kind: "ok", value })

/** What every member module is built from: the client's sender, clock, deps, connection and member runner. */
export type ClientCore = {
  readonly sender: RemoteSender
  readonly timers: Timers
  readonly deps: RemoteClientDeps
  /** Runs `body` on the proven connection under the member's deadline; settles with data, never throws. */
  readonly member: <T>(
    opts: Opts | undefined,
    defaultMs: number,
    mutating: boolean,
    body: (svc: DeviceService) => Promise<Outcome<T>>,
    absent?: () => Outcome<T>,
  ) => R<T>
  readonly sessionsList: (filter?: SessionsListFilter, opts?: Opts) => R<SessionsList>
  readonly devicesList: (opts?: Opts) => R<readonly DeviceRow[]>
}

/** The answer of a member whose part has not landed yet. */
export const notYet = (member: string): RemoteFailure =>
  remoteFailure("unsupported", `${member} is not available in this build.`, nextActionFor("unsupported"), {
    details: { feature: member },
  })

const hostSlug = (): string =>
  hostname()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "this-device"

/** This device with no device service (B1): attachable locally, no machine operations, no host attach setting. */
const localSelfRow = (): DeviceRow => ({
  id: "local",
  name: hostSlug(),
  kind: "local",
  platform: process.platform,
  online: true,
  last_seen_ms: null,
  self: true,
  caps: { attach: true, machine: false, control: false },
})

// A listed device's capabilities are not on its row: attach goes through the device service, machine operations are not
// in this core, and a peer's host attach setting is not listed.
const deviceRow = (row: WireDeviceRow): DeviceRow => ({
  id: row.device,
  name: row.label,
  kind: row.kind,
  platform: row.platform,
  online: row.online,
  last_seen_ms: row.last_seen_ms,
  caps: { attach: true, machine: false, control: false },
})

const unlistedDevice = (id: string): DeviceRow => ({
  id,
  name: id,
  kind: "unknown",
  platform: "unknown",
  online: false,
  last_seen_ms: null,
  caps: { attach: true, machine: false, control: false },
})

const controlUnsupported = (): RemoteFailure =>
  remoteFailure(
    "unsupported",
    "The device service on this device does not have remote control yet.",
    nextActionFor("unsupported"),
    { details: { feature: "control" } },
  )

// Two causes, two answers: this build carries no wake switch at all (no service update enables it), or the device
// service is older than the release that carries it (updating does).
const wakeUnsupported = (svc: DeviceService): RemoteFailure =>
  svc.wakeMarkMinimum === null
    ? remoteFailure("unsupported", "This build of omo does not carry the wake switch yet.", "Update omo, then retry.", {
        details: { feature: "wake", reason: "not_in_build" },
      })
    : remoteFailure(
        "unsupported",
        "The device service on this device cannot wake sessions for other devices yet.",
        nextActionFor("unsupported"),
        { details: { feature: "wake", reason: "service_too_old" } },
      )

const notPerson = (member: string): RemoteFailure =>
  remoteFailure(
    "sender_not_allowed",
    `${member} changes the device service; only a person's client may call it.`,
    `Call ${member} on a person client.`,
  )

/**
 * The one remote client (design v8-core r2, layer L2): ONE device-service connection, role `omo`, opened on the first
 * member that needs it and rebuilt after it closes. Every member settles with data under its deadline (deadlines.ts);
 * none throws. `sender` is fixed here, never taken from a member's parameters.
 */
export function createRemoteClient(sender: RemoteSender, deps: RemoteClientDeps): RemoteClient {
  const timers = deps.timers ?? realTimers
  const stateDir = deps.stateDir ?? deviceServiceStateDir()
  let service: Promise<DeviceService> | undefined
  const connection = (): Promise<DeviceService> => {
    if (service !== undefined) return service
    const opening = (deps.connect ?? connectDeviceService)({ version: deps.version, stateDir, timers }).then(
      (connected) => {
        void connected.closed.then(() => {
          if (service === opening) service = undefined
        })
        return connected
      },
      (error: unknown) => {
        if (service === opening) service = undefined
        throw error
      },
    )
    service = opening
    return opening
  }

  // A cold connect is bounded by the handshake plus CONNECT_SLACK_MS before the member's own clock starts.
  const connected = async (opts: Opts | undefined): Promise<Outcome<DeviceService> | "not_installed"> => {
    if (!existsSync(deviceServiceEndpointPath(stateDir))) return "not_installed"
    const outcome = await withinDeadline(
      timers,
      opts?.signal === undefined ? undefined : { signal: opts.signal },
      BOUNDS.handshake + CONNECT_SLACK_MS,
      false,
      async () => ok(await connection()),
    )
    if (outcome.kind === "error" && outcome.code === "timeout")
      return remoteFailure(
        "host_unavailable",
        "The device service did not complete its handshake.",
        nextActionFor("host_unavailable"),
        {
          details: { phase: "connect" },
        },
      )
    // Every failure before the member's own call (refused, reset, no socket, a bad proof) names the connect phase, so a
    // caller can tell a service that is not serving from a member that failed.
    if (outcome.kind === "error") return { ...outcome, details: { ...outcome.details, phase: "connect" } }
    return outcome
  }

  const member = async <T>(
    opts: Opts | undefined,
    defaultMs: number,
    mutating: boolean,
    body: (svc: DeviceService) => Promise<Outcome<T>>,
    absent?: () => Outcome<T>,
  ): R<T> => {
    try {
      const svc = await connected(opts)
      if (svc === "not_installed")
        return (
          absent?.() ??
          remoteFailure(
            "host_unavailable",
            "The device service is not installed on this device.",
            nextActionFor("host_unavailable"),
            {
              details: { reason: "service_not_installed" },
            },
          )
        )
      if (svc.kind === "error") return svc
      return await withinDeadline(timers, opts, defaultMs, mutating, () => body(svc.value))
    } catch (error) {
      return failureFromError(error, mutating)
    }
  }

  const listDevices = async (svc: DeviceService): Promise<readonly DeviceRow[]> => {
    const [rows, self] = await Promise.all([svc.devices(), svc.thisDevice()])
    const control = svc.capabilities.includes("control")
    const listed = rows.map(deviceRow)
    if (self === null) return [localSelfRow(), ...listed]
    const own = listed.find((row) => row.id === self.id)
    const selfRow: DeviceRow = {
      // A connected service's own device: thisDevice() names no kind, so it is a cli device; "local" is only the row
      // of a device with no service.
      ...(own ?? { ...localSelfRow(), kind: "cli", id: self.id, name: self.name, last_seen_ms: timers.now() }),
      self: true,
      online: true,
      caps: { attach: true, machine: false, control },
    }
    return [selfRow, ...listed.filter((row) => row.id !== self.id)]
  }

  const devicesList = (opts?: Opts): R<readonly DeviceRow[]> =>
    member(
      opts,
      DEADLINES.devices,
      false,
      async (svc) => ok(await listDevices(svc)),
      () => ok([localSelfRow()]),
    )

  const sessionsList = (filter?: SessionsListFilter, opts?: Opts): R<SessionsList> =>
    member(opts, DEADLINES.sessionsList, false, async (svc) => {
      const [listing, devices] = await Promise.all([
        svc.sessions({
          ...(filter?.device === undefined ? {} : { device: filter.device }),
          ...(filter?.project === undefined ? {} : { project: filter.project }),
          ...(filter?.state === undefined ? {} : { state: filter.state }),
        }),
        listDevices(svc),
      ])
      const byId = new Map(devices.map((row) => [row.id, row]))
      const deviceOf = (id: string): DeviceRow => byId.get(id) ?? unlistedDevice(id)
      const wanted = filter?.name?.toLowerCase()
      // This device's own sessions come from its own operator endpoint (#13787): the service's listing does not carry
      // the asking device's sessions. One it already lists by the same durable id keeps the service's row.
      const self = devices.find((row) => row.self === true && row.kind !== "local")
      const listed = listing.rows.map((row) => sessionRow(row, deviceOf(row.device)))
      const local =
        self === undefined || (filter?.device !== undefined && filter.device !== self.id)
          ? []
          : await localSessionRows(deps.localThreadHost ?? defaultLocalThreadHost, self)
      const known = new Set(listed.flatMap((row) => (row.durable_id === undefined ? [] : [row.durable_id])))
      const rows = [
        ...listed,
        ...(local ?? []).filter((row) => row.durable_id === undefined || !known.has(row.durable_id)),
      ]
        .filter((row) => filter?.state === undefined || row.state === filter.state)
        .filter((row) => filter?.project === undefined || row.project === filter.project)
        .filter(
          (row) =>
            (filter?.archived === undefined || row.archived === filter.archived) &&
            (wanted === undefined || row.name.toLowerCase() === wanted),
        )
      // A device that missed the round, or whose answer was cut short (incomplete), lists cached rows at most.
      const unanswered = [
        ...new Set([
          ...listing.incomplete,
          ...Object.entries(listing.devices)
            .filter(([, state]) => state !== "answered")
            .map(([id]) => id),
          // This device's own host did not answer: its sessions are missing from this listing.
          ...(self !== undefined && local === undefined ? [self.id] : []),
        ]),
      ].map(deviceOf)
      return ok({ revision: listing.revision, rows, unanswered })
    })

  const core: ClientCore = { sender, timers, deps, member, sessionsList, devicesList }

  return {
    service: {
      info: (opts) =>
        member(opts, DEADLINES.service, false, async (svc) =>
          ok({ service_version: svc.serviceVersion, capabilities: svc.capabilities }),
        ),
      // One call answers both: the state and the version of the service that reported it.
      status: (opts) =>
        member(opts, DEADLINES.service, false, async (svc) =>
          ok({ ...(await svc.status()), service_version: svc.serviceVersion }),
        ),
      setEnabled: async (on, opts) =>
        sender.kind !== "person"
          ? notPerson("service.setEnabled")
          : member(opts, DEADLINES.service, true, async (svc) => ok({ enabled: await svc.setEnabled(on) })),
      control: (opts) =>
        member(opts, DEADLINES.service, false, async (svc) =>
          svc.capabilities.includes("control") ? ok(await svc.attachControl()) : controlUnsupported(),
        ),
      setControl: async (on, opts) =>
        sender.kind !== "person"
          ? notPerson("service.setControl")
          : member(opts, DEADLINES.service, true, async (svc) =>
              svc.capabilities.includes("control") ? ok(await svc.setAttachControl(on)) : controlUnsupported(),
            ),
      // The bootstrap installs and connects the service itself, so it holds no connection of this client. Its caller is
      // a person or the internal bootstrap entry's service client (B4).
      bootstrap: async (setup, opts) => {
        if (sender.kind !== "person" && sender.kind !== "service") return notPerson("service.bootstrap")
        const run = deps.bootstrap
        if (run === undefined)
          return remoteFailure(
            "unsupported",
            "This client was built without the device service bootstrap.",
            "Call service.bootstrap on the client the bootstrap entry builds.",
            { details: { feature: "bootstrap" } },
          )
        return await withinDeadline(timers, opts, DEADLINES.bootstrap, true, async () => ok(await run(setup)))
      },
      // The gate is this connection's own service version (A7R-11), never a capability word.
      wake: (opts) =>
        member(opts, DEADLINES.service, false, async (svc) =>
          svc.carriesWakeMark ? ok(await svc.sessionWake()) : wakeUnsupported(svc),
        ),
      setWake: async (on, opts) =>
        sender.kind !== "person"
          ? notPerson("service.setWake")
          : member(opts, DEADLINES.service, true, async (svc) =>
              svc.carriesWakeMark ? ok(await svc.setSessionWake(on)) : wakeUnsupported(svc),
            ),
    },
    devices: {
      list: devicesList,
      resolve: async (idOrName, opts) => {
        const listed = await devicesList(opts)
        if (listed.kind === "error") return listed
        const byId = listed.value.find((row) => row.id === idOrName)
        if (byId !== undefined) return ok(byId)
        const wanted = idOrName.toLowerCase()
        const byName = listed.value.filter((row) => row.name.toLowerCase() === wanted)
        if (byName.length === 1 && byName[0] !== undefined) return ok(byName[0])
        if (byName.length > 1)
          return remoteFailure(
            "ambiguous_target",
            `${byName.length} devices are named ${idOrName}.`,
            "Pass the device id.",
            {
              details: { candidates: byName.map((row) => ({ id: row.id, name: row.name })) },
            },
          )
        return remoteFailure("not_found", `No device has the id or name ${idOrName}.`, nextActionFor("not_found"), {
          details: { kind: "device" },
        })
      },
    },
    sessions: {
      list: sessionsList,
      resolve: resolveMember(core),
      ...sessionMembers(core),
      ...streamMembers(core),
    },
    attach: attachMember(core),
    aliases: aliasMembers(core),
    close: () => {
      const open = service
      service = undefined
      void open?.then(
        (svc) => svc.close(),
        () => undefined,
      )
    },
  }
}

// The listing carries one display name per session (its title); archive state has no layer yet (E-archive), so every
// row is unarchived. The handle is the `<device>/<session>` form seam 1 parses.
const sessionRow = (row: ListingRow, device: DeviceRow): SessionRow => ({
  thread: handleOf(row.device, row.session_id),
  ...durableIdOf(row),
  name: row.title,
  title: row.title,
  device,
  project: row.project,
  path: row.path,
  state: row.state,
  archived: false,
  updated_ms: row.updated_ms,
  source: row.source,
})

// The listing's optional durable_id (#12996); a service that predates it lists none.
const durableIdOf = (row: object): { readonly durable_id?: string } => {
  const value = Reflect.get(row, "durable_id")
  return typeof value === "string" && value !== "" ? { durable_id: value } : {}
}
