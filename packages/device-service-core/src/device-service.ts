import { homedir } from "node:os"
import { join } from "node:path"
import { SOCKET_FILE } from "./local-api/access.ts"
import { connectLocalApi, type ConnectOptions, type LocalApiClient } from "./local-api/client.ts"
import { ENDPOINT_FILE } from "./local-api/transport.ts"
import type { ListingResult, ListingRevision } from "./local-api/client-assembly.ts"
import type { DeviceRef, DeviceRow, SessionFilter, Status } from "./local-api/protocol.ts"
import { openAttach, type RemoteAttach } from "./remote-attach.ts"

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
export type { AttachEnd, RemoteAttach, RemoteAttachEvent } from "./remote-attach.ts"

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

export type DeviceService = {
  readonly serviceVersion: string
  /** The status the service sent in its welcome. */
  readonly initialStatus: Status
  readonly status: () => Promise<Status>
  /** Calls `listener` with the current status, then after every change, until the returned function is called. */
  readonly watchStatus: (listener: (status: Status) => void) => Promise<() => void>
  readonly setEnabled: (enabled: boolean) => Promise<boolean>
  /** The binary the service runs to refresh its access token (absolute path) and that binary's version. */
  readonly registerRefresher: (binaryPath: string, version: string) => Promise<void>
  /** Hands the signed-in device and its keys (base64 PKCS#8 DER) to the service; never logged or echoed. */
  readonly adopt: (credential: DeviceCredential) => Promise<DeviceRef>
  readonly registerEndpoints: (agentDir: string) => Promise<void>
  /** The service forgets the device and reports signed_out; it keeps running. */
  readonly forget: () => Promise<void>
  readonly thisDevice: () => Promise<DeviceRef | null>
  readonly devices: () => Promise<readonly DeviceRow[]>
  /** One listing round across the account's devices; `onRevision` sees each complete revision as it lands. */
  readonly sessions: (filter?: SessionFilter, onRevision?: (revision: ListingRevision) => void) => Promise<ListingResult>
  readonly attach: (device: string, sessionId: string) => Promise<RemoteAttach>
  readonly close: () => void
  readonly closed: Promise<void>
}

export type DeviceCredential = {
  readonly device: DeviceRef
  readonly signingPrivateKey: string
  readonly sealingPrivateKey: string
}

export type ConnectDeviceServiceOptions = {
  /** The version of this omo build, reported to the service in its hello. */
  readonly version: string
  readonly stateDir?: string
  /** Test seam: the local API connection (the vendored v1 client by default). */
  readonly connect?: (options: ConnectOptions) => Promise<LocalApiClient>
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
    registerRefresher: async (binaryPath, version) => {
      await client.request("refresher.register", { binary_path: binaryPath, version })
    },
    adopt: async ({ device, signingPrivateKey, sealingPrivateKey }) =>
      (await client.request("device.adopt", { device, signing_private_key: signingPrivateKey, sealing_private_key: sealingPrivateKey }))
        .device,
    registerEndpoints: async agentDir => {
      await client.request("endpoints.register", { agent_dir: agentDir })
    },
    forget: async () => {
      await client.request("device.forget", {})
    },
    thisDevice: async () => (await client.request("device.info", {})).device,
    devices: async () => (await client.request("devices.list", {})).devices,
    sessions: (filter, onRevision) => client.list(filter, onRevision),
    attach: (device, sessionId) => openAttach(client, device, sessionId),
    close: () => client.close(),
    closed: client.closed,
  }
}
