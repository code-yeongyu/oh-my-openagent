import { existsSync } from "node:fs"
import { hostname } from "node:os"
import {
  connectDeviceService,
  deviceServiceEndpointPath,
  deviceServiceStateDir,
  realTimers,
  type DeviceService,
  type DeviceRow as WireDeviceRow,
  type ListingRow,
  type Timers,
} from "@oh-my-opencode/device-service-core"
import { failureFromError, nextActionFor, remoteFailure } from "./codes"
import { BOUNDS, CONNECT_SLACK_MS, DEADLINES, withinDeadline } from "./deadlines"
import type {
  BootstrapResult,
  BootstrapSetup,
  ControlState,
  DeviceRow,
  Opts,
  R,
  RemoteFailure,
  RemoteSender,
  ServiceInfo,
  ServiceStatus,
  SessionRow,
  SessionsList,
  SessionsListFilter,
} from "./types"

export type RemoteClientDeps = {
  readonly version: string
  readonly stateDir?: string
  /** The clock seam: every deadline of the client and of its connection runs on it (real timers by default). */
  readonly timers?: Timers
  /** Runs the device service bootstrap for `service.bootstrap`; the internal bootstrap entry provides it (part 4c-3). */
  readonly bootstrap?: (setup: BootstrapSetup) => Promise<BootstrapResult>
}

/** The members of part 4a-1 (design v8-core r2, B1); sessions.get onward land with their parts. */
export type RemoteClient = {
  readonly service: {
    readonly info: (opts?: Opts) => R<ServiceInfo>
    readonly status: (opts?: Opts) => R<ServiceStatus>
    readonly setEnabled: (on: boolean, opts?: Opts) => R<{ readonly enabled: boolean }>
    readonly control: (opts?: Opts) => R<ControlState>
    readonly setControl: (on: boolean, opts?: Opts) => R<ControlState>
    readonly bootstrap: (setup: BootstrapSetup, opts?: Opts) => R<BootstrapResult>
  }
  readonly devices: {
    readonly list: (opts?: Opts) => R<readonly DeviceRow[]>
    readonly resolve: (idOrName: string, opts?: Opts) => R<DeviceRow>
  }
  readonly sessions: { readonly list: (filter?: SessionsListFilter, opts?: Opts) => R<SessionsList> }
  readonly close: () => void
}

type Outcome<T> = { readonly kind: "ok"; readonly value: T } | RemoteFailure
const ok = <T>(value: T): Outcome<T> => ({ kind: "ok", value })

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
    const opening = connectDeviceService({ version: deps.version, stateDir, timers }).then(
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
      ...(own ?? { ...localSelfRow(), id: self.id, name: self.name, last_seen_ms: timers.now() }),
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

  return {
    service: {
      info: (opts) =>
        member(opts, DEADLINES.service, false, async (svc) =>
          ok({ service_version: svc.serviceVersion, capabilities: svc.capabilities }),
        ),
      status: (opts) => member(opts, DEADLINES.service, false, async (svc) => ok(await svc.status())),
      setEnabled: async (on, opts) =>
        sender.kind !== "person"
          ? notPerson("service.setEnabled")
          : member(opts, DEADLINES.service, true, async (svc) => ok({ enabled: await svc.setEnabled(on) })),
      control: (opts) => member(opts, DEADLINES.service, false, async (svc) => ok(await svc.attachControl())),
      setControl: async (on, opts) =>
        sender.kind !== "person"
          ? notPerson("service.setControl")
          : member(opts, DEADLINES.service, true, async (svc) => ok(await svc.setAttachControl(on))),
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
      list: (filter, opts) =>
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
          const rows = listing.rows
            .map((row) => sessionRow(row, deviceOf(row.device)))
            .filter(
              (row) =>
                (filter?.archived === undefined || row.archived === filter.archived) &&
                (wanted === undefined || row.name.toLowerCase() === wanted),
            )
          const unanswered = Object.entries(listing.devices)
            .filter(([, state]) => state !== "answered")
            .map(([id]) => deviceOf(id))
          return ok({ revision: listing.revision, rows, unanswered })
        }),
    },
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
  thread: `${row.device}/${row.session_id}`,
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
