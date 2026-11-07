import { homedir } from "node:os"
import { join } from "node:path"
import { SOCKET_FILE } from "./local-api/access.ts"
import { connectLocalApi, type ConnectOptions, type LocalApiClient } from "./local-api/client.ts"
import { connectLocal, ENDPOINT_FILE } from "./local-api/transport.ts"
import type { ListingResult, ListingRevision } from "./local-api/client-assembly.ts"
import type { Capability, ControlAttachState, DeviceRef, DeviceRow, SessionFilter, Status } from "./local-api/protocol.ts"
import { type CommandResult, openAttach, PROGRESS_STATES, type RemoteAttach } from "./remote-attach.ts"
import { followDelegatedChannel } from "./delegated-channel.ts"
import { LocalApiError } from "./local-api/errors.ts"
import type { CommandRpc } from "./local-api/protocol.ts"
import type { SessionCandidate } from "./local-api/protocol-delegated.ts"
import { randomBytes } from "node:crypto"

// A host sends no command state at all for a route it does not list toward a sender it does not grant (docs/local-api.md
// "Delegated commands"), so the client bounds its own wait.
const ENDPOINT_COMMAND_WAIT_MS = 120_000

function sendToEndpoint(client: LocalApiClient, device: string, endpoint: string, rpc: CommandRpc): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve, reject) => {
    // Minted before sending, so a state that arrives ahead of the answer is not missed.
    const commandId = randomBytes(16).toString("base64url")
    const channel = followDelegatedChannel(device)
    let done = false
    const settle = (): void => {
      done = true
      stop()
      channel.stop()
      clearTimeout(timer)
    }
    const fail = (error: unknown): void => {
      if (done) return
      settle()
      reject(error)
    }
    const stop = client.onEvent(event => {
      channel.accept(event)
      if (done || event.kind !== "session.command_state" || event.command_id !== commandId) return
      if (PROGRESS_STATES.has(event.state)) return
      const response = channel.takeReply(commandId)
      settle()
      resolve(response === undefined ? { outcome: event } : { outcome: event, response })
    })
    const timer = setTimeout(() => fail(new Error(`no final state for endpoint command ${commandId} within ${ENDPOINT_COMMAND_WAIT_MS} ms`)), ENDPOINT_COMMAND_WAIT_MS)
    timer.unref?.()
    void client.closed.then(() => fail(new Error("the connection closed before the endpoint command settled")))
    client.endpointCommand(device, endpoint, rpc, commandId).catch(fail)
  })
}

const markNotSent = (error: unknown): unknown =>
  error instanceof LocalApiError
    ? new LocalApiError(error.code, error.reason, {
        action: error.action,
        ...(error.limit_chars === undefined ? {} : { limit_chars: error.limit_chars }),
        ...(error.path_refusal === undefined ? {} : { path_refusal: error.path_refusal }),
        not_sent: true,
      })
    : error

export type { ListingResult, ListingRevision, ReadPage, ReadPageEntry } from "./local-api/client-assembly.ts"
export { LocalApiError } from "./local-api/errors.ts"
export type {
  Capability,
  CommandRpc,
  CommandStateEvent,
  ControlAttachState,
  DetachReason,
  DeviceRef,
  DeviceRow,
  JsonObject,
  ListingRow,
  RoundDeviceState,
  SessionFilter,
  SessionRowState,
  SnapshotBody,
  Status,
  StatusState,
} from "./local-api/protocol.ts"
export { SESSION_ROW_STATES } from "./local-api/protocol.ts"
export type { AttachEnd, CommandResult, RemoteAttach, RemoteAttachEvent } from "./remote-attach.ts"

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
  /** What the service advertised in its welcome; `control` means it has the host attach setting. */
  readonly capabilities: readonly Capability[]
  /** The status the service sent in its welcome. */
  readonly initialStatus: Status
  readonly status: () => Promise<Status>
  /** Calls `listener` with the current status, then after every change, until the returned function is called. */
  readonly watchStatus: (listener: (status: Status) => void) => Promise<() => void>
  readonly setEnabled: (enabled: boolean) => Promise<boolean>
  /** Whether this account's other devices may view and command this device's sessions (the per-device opt-out). */
  readonly attachControl: () => Promise<ControlAttachState>
  readonly setAttachControl: (attached: boolean) => Promise<ControlAttachState>
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
  /**
   * Sends one session-less engine record (`open_session`, `list_sessions`, ...) to `device`'s engine endpoint with no
   * attach: relay daemon #393's `session.command {device, endpoint, rpc}`, on the key `session.endpoints` lists first.
   * Settles like an attach's command: the first command state that is not a progress state, plus the engine's reply.
   * Rejects with the local API's refusal (`unsupported` when the device lists no endpoint, before anything is sent), or
   * when the connection closes or no final state arrives within ENDPOINT_COMMAND_WAIT_MS. Every failure before
   * `session.command` is written (the `session.endpoints` lookup, whatever its code) is a `LocalApiError` with
   * `not_sent: true`; a `session.command` that times out after sending carries its `command_id` instead.
   */
  readonly endpointCommand: (device: string, rpc: CommandRpc) => Promise<CommandResult>
  readonly close: () => void
  readonly closed: Promise<void>
  /**
   * #393 part B's `session.locate {device, engine_id}`: the session a create over `device`'s engine endpoint made,
   * found by the durable engine session id in the create reply. `key` is the session's id in the device's listing,
   * the one `attach` takes; the engine id itself is in no listing row.
   */
  readonly locate: (device: string, engineId: string) => Promise<SessionCandidate>
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
  /** The connection never keeps the process alive: a long-lived engine-side client, not a CLI verb. */
  readonly background?: boolean
  /** Test seam: the local API connection (the vendored v1 client by default). */
  readonly connect?: (options: ConnectOptions) => Promise<LocalApiClient>
}

/** Opens a proven connection to this device's service (mutual proof before any request) and returns the typed SDK. */
export async function connectDeviceService(options: ConnectDeviceServiceOptions): Promise<DeviceService> {
  const stateDir = options.stateDir ?? deviceServiceStateDir()
  const client = await (options.connect ?? connectLocalApi)({
    stateDir,
    client: { name: "omo", version: options.version },
    ...(options.background === true ? { transport: () => connectLocal(stateDir, { background: true }) } : {}),
  })
  return {
    serviceVersion: client.welcome.service_version,
    capabilities: client.welcome.capabilities,
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
    attachControl: () => client.request("control.attach.get", {}),
    setAttachControl: attached => client.request("control.attach.set", { attached }),
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
    endpointCommand: async (device, rpc) => {
      // The endpoint lookup runs before any session.command is written, so whatever fails it (a timeout, a closed
      // connection, a refusal) dispatched nothing: it is marked not_sent, unlike a timeout after sending.
      let endpoint: string | undefined
      try {
        endpoint = (await client.request("session.endpoints", { device })).endpoints[0]
      } catch (error) {
        throw markNotSent(error)
      }
      if (endpoint === undefined) throw new LocalApiError("unsupported", "the device lists no engine endpoint", { not_sent: true })
      return await sendToEndpoint(client, device, endpoint, rpc)
    },
    close: () => client.close(),
    closed: client.closed,
    locate: (device, engineId) => client.request("session.locate", { device, engine_id: engineId }),
  }
}
