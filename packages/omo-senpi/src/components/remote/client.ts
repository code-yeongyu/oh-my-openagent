import { existsSync } from "node:fs"
import { hostname } from "node:os"
import {
  connectDeviceService,
  deviceServiceEndpointPath,
  deviceServiceStateDir,
  realTimers,
  type DeviceService,
  type DeviceRow as WireDeviceRow,
  type RemoteAttach,
  type ListingRow,
  type Timers,
} from "@oh-my-opencode/device-service-core/device-service"
import { aliasMembers } from "./aliases"
import { attachMember } from "./attach"
import { failureFromError, nextActionFor, remoteFailure } from "./codes"
import { BOUNDS, CONNECT_SLACK_MS, DEADLINES, withinDeadline } from "./deadlines"
import { streamMembers } from "./follow"
import { resolveMember } from "./resolve"
import type { LocalSessions } from "./local-sessions"
import { handleOf } from "./seams"
import { sessionMembers } from "./sessions"
import { thisDeviceRow } from "./this-device-row"
import type {
  DeviceRow,
  Opts,
  R,
  RemoteClient,
  RemoteClientDeps as RemoteClientDepsOver,
  RemoteFailure,
  RemoteSender,
  SessionRow,
  SessionsList,
  SessionsListFilter,
} from "./types"
import { unknownDevice } from "./unknown-device"

/** The client's deps over the device service SDK's own connection and attach (types.ts `RemoteClientDeps`). */
export type RemoteClientDeps = RemoteClientDepsOver<DeviceService, RemoteAttach> & {
  /**
   * This device's own operator endpoint (`local-sessions.ts` `createLocalSessions`), where its sessions are listed, opened
   * and driven (#13787). It opens sockets, so a caller outside `omo remote`'s local-only graph (#13440) injects it, and
   * may load it lazily: it is loaded once, on the first member that needs it. Absent, sessions.list names this device
   * unanswered (its sessions are missing from the listing, as when its host does not answer), and every other session
   * member on this device answers `unsupported{feature:"local_sessions"}`.
   */
  readonly localSessions?: () => Promise<LocalSessions>
}
export type { RemoteClient }

export type Outcome<T> = { readonly kind: "ok"; readonly value: T } | RemoteFailure
export const ok = <T>(value: T): Outcome<T> => ({ kind: "ok", value })

/** What every member module is built from: the client's sender, clock, deps, connection and member runner. */
export type ClientCore = {
  readonly sender: RemoteSender
  readonly timers: Timers
  readonly deps: RemoteClientDeps
  /** Opens a new proven connection, as the client's own is opened; the caller owns it and closes it. */
  readonly dial: () => Promise<DeviceService>
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
  /**
   * The client these members belong to, for the thread bodies a member runs (they read the account through a client):
   * valid once the client is built, which is before any member can be called.
   */
  readonly self: () => RemoteClient
  /** This device's operator endpoint leg (RemoteClientDeps.localSessions), loaded once; undefined when not injected. */
  readonly localSessions: () => Promise<LocalSessions | undefined>
}

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
  let localLeg: Promise<LocalSessions> | undefined
  const localSessions = async (): Promise<LocalSessions | undefined> => {
    const load = deps.localSessions
    if (load === undefined) return undefined
    localLeg ??= load()
    return await localLeg
  }
  const dial = (): Promise<DeviceService> =>
    (deps.connect ?? connectDeviceService)({ version: deps.version, stateDir, timers })
  const connection = (): Promise<DeviceService> => {
    if (service !== undefined) return service
    const opening = dial().then(
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
    const [rows, self, status] = await Promise.all([svc.devices(), svc.thisDevice(), svc.status()])
    const listed = rows.map(deviceRow)
    if (self === null) return [localSelfRow(), ...listed]
    const own = listed.find((row) => row.id === self.id)
    const selfRow = thisDeviceRow(self, own, status, timers.now(), svc.capabilities.includes("control"))
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

  /**
   * This device's own sessions, under a bound of their own that ends before the listing's (#13787 review L1): a host that
   * takes list_sessions and never answers leaves this device unanswered, never the whole listing a timeout.
   */
  const localRowsBefore = async (end: number, self: DeviceRow): Promise<readonly SessionRow[] | undefined> => {
    const ms = Math.max(0, Math.min(DEADLINES.sessionsListLocal, end - timers.now() - 1))
    const answered = await withinDeadline(timers, undefined, ms, false, async () => {
      const leg = await localSessions()
      return ok(leg === undefined ? undefined : await leg.rows(self))
    })
    return answered.kind === "ok" ? answered.value : undefined
  }

  const sessionsList = (filter?: SessionsListFilter, opts?: Opts): R<SessionsList> =>
    member(opts, DEADLINES.sessionsList, false, async (svc) => {
      // The listing's own deadline, whose clock member starts as this body does.
      const end = timers.now() + (opts?.deadlineMs ?? DEADLINES.sessionsList)
      const [listing, devices] = await Promise.all([
        svc.sessions({
          ...(filter?.device === undefined ? {} : { device: filter.device }),
          ...(filter?.project === undefined ? {} : { project: filter.project }),
          ...(filter?.state === undefined ? {} : { state: filter.state }),
        }),
        listDevices(svc),
      ])
      const byId = new Map(devices.map((row) => [row.id, row]))
      const unknown = unknownDevice(filter?.device, byId, listing)
      if (unknown !== undefined) return unknown
      const deviceOf = (id: string): DeviceRow => byId.get(id) ?? unlistedDevice(id)
      const wanted = filter?.name?.toLowerCase()
      // This device's own sessions come from its own operator endpoint (#13787): the service's listing does not carry
      // the asking device's sessions. One it already lists by the same durable id keeps the service's row.
      const self = devices.find((row) => row.self === true && row.kind !== "local")
      const listed = listing.rows.map((row) => sessionRow(row, deviceOf(row.device)))
      const local =
        self === undefined || (filter?.device !== undefined && filter.device !== self.id)
          ? []
          : await localRowsBefore(end, self)
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

  let built: RemoteClient | undefined
  const self = (): RemoteClient => {
    if (built === undefined) throw new Error("the remote client was used before it was built")
    return built
  }
  const core: ClientCore = { sender, timers, deps, dial, member, sessionsList, devicesList, localSessions, self }

  built = {
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
  return built
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
