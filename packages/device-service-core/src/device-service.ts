import { homedir } from "node:os"
import { join } from "node:path"
import { SOCKET_FILE } from "./local-api/access.ts"
import { connectLocalApi, type ConnectOptions, type LocalApiClient } from "./local-api/client.ts"
import { LocalApiError } from "./local-api/errors.ts"
import { ENDPOINT_FILE } from "./local-api/transport.ts"
import type { ListingResult, ListingRevision, ReadPage } from "./local-api/client-assembly.ts"
import type {
  AttachPendingReason,
  DetachReason,
  DeviceRef,
  DeviceRow,
  JsonObject,
  LocalEvent,
  SessionFilter,
  SnapshotBody,
  Status,
} from "./local-api/protocol.ts"

export type { ListingResult, ListingRevision, ReadPage, ReadPageEntry } from "./local-api/client-assembly.ts"
export { LocalApiError } from "./local-api/errors.ts"
export type {
  DetachReason,
  DeviceRef,
  DeviceRow,
  ListingRow,
  RoundDeviceState,
  SessionFilter,
  SessionRowState,
  SnapshotBody,
  Status,
  StatusState,
} from "./local-api/protocol.ts"
export { SESSION_ROW_STATES } from "./local-api/protocol.ts"

type Env = Readonly<Record<string, string | undefined>>

/** `~/.omo/device-service` (POSIX) or `%LOCALAPPDATA%\OmO\device-service` (Windows): where the service's endpoint and per-boot token live. */
export function deviceServiceStateDir(
  platform: NodeJS.Platform = process.platform,
  env: Env = process.env,
  home: string = homedir(),
): string {
  if (platform !== "win32") return join(home, ".omo", "device-service")
  const localAppData = env.LOCALAPPDATA ?? join(home, "AppData", "Local")
  return join(localAppData, "OmO", "device-service")
}

/** The file a running service publishes in its state dir: the socket on POSIX, the port file on Windows. */
export function deviceServiceEndpointPath(stateDir: string, platform: NodeJS.Platform = process.platform): string {
  return join(stateDir, platform === "win32" ? ENDPOINT_FILE : SOCKET_FILE)
}

/** How an attach ended: a service-reported reason, the connection closing, or this client's own detach. */
export type AttachEnd = DetachReason | "closed" | "detached" | "listener_failed"

export type RemoteAttachEvent =
  | { readonly kind: "pending"; readonly reason: AttachPendingReason }
  | { readonly kind: "snapshot"; readonly snapshot: SnapshotBody }
  | { readonly kind: "records"; readonly attach_id: number; readonly records: readonly JsonObject[] }
  | { readonly kind: "detached"; readonly reason: DetachReason }

export type RemoteAttach = {
  readonly device: string
  readonly sessionId: string
  /** The local handle the service gave this attach (owned by this connection). */
  readonly handle: string
  /** The first snapshot, inline or reassembled from its blob; a later re-attach replaces it through `onEvent`. */
  readonly snapshot: Promise<SnapshotBody>
  /** Settles with the reason once the attach ends, whoever ended it. */
  readonly detached: Promise<AttachEnd>
  /** Every event of this attach in order, replayed from the latest snapshot for a listener added later. */
  readonly onEvent: (listener: (event: RemoteAttachEvent) => void) => () => void
  /** One page of older history; entries too large to fetch are marked `too_large`. */
  readonly read: (options?: { readonly before?: string; readonly tail?: number }) => Promise<ReadPage>
  /** Detaches; afterwards this attach holds no subscription on the connection and `detached` settles "detached". */
  readonly detach: () => Promise<void>
  /** The error a listener threw, which ended the attach with "listener_failed"; undefined otherwise. */
  readonly failure: () => unknown
}

export type DeviceService = {
  readonly serviceVersion: string
  /** The status the service sent in its welcome. */
  readonly initialStatus: Status
  readonly status: () => Promise<Status>
  /** Calls `listener` with the current status, then after every change, until the returned function is called. */
  readonly watchStatus: (listener: (status: Status) => void) => Promise<() => void>
  readonly setEnabled: (enabled: boolean) => Promise<boolean>
  readonly thisDevice: () => Promise<DeviceRef | null>
  readonly devices: () => Promise<readonly DeviceRow[]>
  /** One listing round across the account's devices; `onRevision` sees each complete revision as it lands. */
  readonly sessions: (filter?: SessionFilter, onRevision?: (revision: ListingRevision) => void) => Promise<ListingResult>
  readonly attach: (device: string, sessionId: string) => Promise<RemoteAttach>
  readonly close: () => void
  readonly closed: Promise<void>
}

export type ConnectDeviceServiceOptions = {
  /** The version of this omo build, reported to the service in its hello. */
  readonly version: string
  readonly stateDir?: string
  /** Test seam: the local API connection (the vendored v1 client by default). */
  readonly connect?: (options: ConnectOptions) => Promise<LocalApiClient>
}

type AttachEvent = Extract<
  LocalEvent,
  { readonly kind: "session.snapshot" | "session.records" | "session.attach_pending" | "session.detached" }
>

const attachEvent = (event: LocalEvent): AttachEvent | undefined => {
  switch (event.kind) {
    case "session.snapshot":
    case "session.records":
    case "session.attach_pending":
    case "session.detached":
      return event
    default:
      return undefined
  }
}

const toRemote = (event: AttachEvent): RemoteAttachEvent => {
  switch (event.kind) {
    case "session.snapshot": {
      const { type: _type, kind: _kind, attach: _attach, ...snapshot } = event
      return { kind: "snapshot", snapshot }
    }
    case "session.records":
      return { kind: "records", attach_id: event.attach_id, records: event.records }
    case "session.attach_pending":
      return { kind: "pending", reason: event.reason }
    case "session.detached":
      return { kind: "detached", reason: event.reason }
  }
}

function openAttach(client: LocalApiClient, device: string, sessionId: string): Promise<RemoteAttach> {
  // Events of the new attach can arrive before its handle is known, so they wait here until the response names it.
  const early: AttachEvent[] = []
  const history: RemoteAttachEvent[] = []
  const listeners = new Set<(event: RemoteAttachEvent) => void>()
  let handle: string | undefined
  let resolveSnapshot!: (snapshot: SnapshotBody) => void
  let rejectSnapshot!: (error: Error) => void
  const snapshot = new Promise<SnapshotBody>((resolve, reject) => {
    resolveSnapshot = resolve
    rejectSnapshot = reject
  })
  snapshot.catch(() => {})
  let resolveDetached!: (reason: AttachEnd) => void
  const detached = new Promise<AttachEnd>(resolve => {
    resolveDetached = resolve
  })
  let ended = false
  let failure: unknown
  const finish = (reason: AttachEnd) => {
    if (ended) return
    ended = true
    stop()
    listeners.clear()
    rejectSnapshot(new Error(`the attach ended before its snapshot: ${reason}`))
    resolveDetached(reason)
  }
  // Listeners run inside the connection's data handler: a throw there must end this attach, never the connection.
  const deliver = (event: AttachEvent) => {
    const remote = toRemote(event)
    if (remote.kind === "snapshot") {
      history.length = 0
      resolveSnapshot(remote.snapshot)
    }
    history.push(remote)
    for (const listener of [...listeners]) {
      try {
        listener(remote)
      } catch (error) {
        failure = error
        finish("listener_failed")
        return
      }
    }
    if (remote.kind === "detached") finish(remote.reason)
  }
  const stop = client.onEvent(event => {
    const mine = attachEvent(event)
    if (mine === undefined) return
    if (handle === undefined) early.push(mine)
    else if (mine.attach === handle) deliver(mine)
  })
  void client.closed.then(() => finish("closed"))
  return client.request("session.attach", { device, session_id: sessionId }).then(
    ({ attach }) => {
      handle = attach
      for (const event of early.splice(0)) if (event.attach === attach) deliver(event)
      return {
        device,
        sessionId,
        handle: attach,
        snapshot,
        detached,
        onEvent: listener => {
          for (const event of history) listener(event)
          if (!ended) listeners.add(listener)
          return () => listeners.delete(listener)
        },
        failure: () => failure,
        read: (options = {}) =>
          client.read(attach, {
            ...(options.before === undefined ? {} : { before_entry_id: options.before }),
            ...(options.tail === undefined ? {} : { tail: options.tail }),
          }),
        detach: async () => {
          try {
            await client.request("session.detach", { attach })
          } catch (error) {
            if (!(error instanceof LocalApiError && error.code === "not_attached")) throw error
          }
          finish("detached")
        },
      }
    },
    (error: unknown) => {
      stop()
      throw error
    },
  )
}

/** Opens a proven connection to this device's service (mutual proof before any request) and returns the typed SDK. */
export async function connectDeviceService(options: ConnectDeviceServiceOptions): Promise<DeviceService> {
  const stateDir = options.stateDir ?? deviceServiceStateDir()
  const client = await (options.connect ?? connectLocalApi)({ stateDir, client: { name: "omo", version: options.version } })
  return {
    serviceVersion: client.welcome.service_version,
    initialStatus: client.welcome.state,
    status: () => client.request("status.get", {}),
    watchStatus: async listener => {
      const stop = client.onEvent(event => {
        if (event.kind === "status.changed") listener(event.status)
      })
      try {
        await client.request("status.subscribe", {})
      } catch (error) {
        stop()
        throw error
      }
      return stop
    },
    setEnabled: async enabled => (await client.request("service.set_enabled", { enabled })).enabled,
    thisDevice: async () => (await client.request("device.info", {})).device,
    devices: async () => (await client.request("devices.list", {})).devices,
    sessions: (filter, onRevision) => client.list(filter, onRevision),
    attach: (device, sessionId) => openAttach(client, device, sessionId),
    close: () => client.close(),
    closed: client.closed,
  }
}
