import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { SOCKET_FILE } from "./local-api/access.ts"
import { connectLocalApi, type ConnectOptions, type LocalApiClient } from "./local-api/client.ts"
import { ENDPOINT_FILE } from "./local-api/transport.ts"
import { connectLocalBackground } from "./background-transport.ts"
import { markNotSent, NotSentError, olderThanWakeMinimum } from "./not-sent-error.ts"
import type { ListingResult, ListingRevision } from "./local-api/client-assembly.ts"
import type {
  Capability,
  ControlAttachState,
  ControlSessionWakeState,
  DeviceRef,
  DeviceRow,
  SessionFilter,
  Status,
} from "./local-api/protocol.ts"
import { type CommandResult, openAttach, PROGRESS_STATES, type RemoteAttach } from "./remote-attach.ts"
import { followDelegatedChannel } from "./delegated-channel.ts"
import { LocalApiError } from "./local-api/errors.ts"
import { REFUSED_BEFORE_SENDING } from "./refused-before-sending.ts"
import { newestRowsListing } from "./listing-rows.ts"
import type { CommandRpc } from "./local-api/protocol.ts"
import type { SessionCandidate } from "./local-api/protocol-command.ts"
import { randomBytes } from "node:crypto"
import { minimumInEffect, type MinimumsOption } from "./minimum-in-effect.ts"
import { compareVersions } from "./release/version.ts"
import { deviceServiceStateDir } from "./state-dir.ts"
import { engineEndpointOf } from "./engine-endpoint.ts"
import { deadlineTimerOf, realTimers, type Timers } from "./timers.ts"

// A host sends no command state at all for a route it does not list toward a sender it does not grant (docs/local-api.md
// "Delegated commands"), so the client bounds its own wait.
const ENDPOINT_COMMAND_WAIT_MS = 120_000

function sendToEndpoint(
  client: LocalApiClient,
  device: string,
  endpoint: string,
  rpc: CommandRpc,
  locate: boolean,
  timers: Timers,
  waitMs?: number,
): Promise<CommandResult> {
  // A service before decision 0018's 2026-11-06 amendment refuses the unknown `locate` field with invalid_request
  // before routing anything, so the command id is still unbound and the same command goes again without it; its
  // reply then names no `located` and the caller locates as before.
  return followDelegatedCommand(
    client,
    device,
    timers,
    (commandId) => {
      const send = (asked: boolean): Promise<unknown> =>
        client.commandTo({ device, endpoint }, rpc, commandId, asked ? { locate: true } : {})
      return send(locate).catch((error: unknown) =>
        locate && error instanceof LocalApiError && error.code === "invalid_request"
          ? send(false)
          : Promise.reject(error),
      )
    },
    waitMs,
  )
}

/**
 * Sends one delegated command toward `device` (its id minted first, so a state that arrives ahead of the answer is not
 * missed) and settles with its first command state that is not a progress state, plus the engine's reply.
 */
function followDelegatedCommand(
  client: LocalApiClient,
  device: string,
  timers: Timers,
  send: (commandId: string) => Promise<unknown>,
  waitMs: number = ENDPOINT_COMMAND_WAIT_MS,
): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve, reject) => {
    // Minted before sending, so a state that arrives ahead of the answer is not missed.
    const commandId = randomBytes(16).toString("base64url")
    const channel = followDelegatedChannel(device)
    let done = false
    const settle = (): void => {
      done = true
      stop()
      channel.stop()
      cancelTimer()
    }
    const fail = (error: unknown): void => {
      if (done) return
      settle()
      reject(error)
    }
    const stop = client.onEvent((event) => {
      channel.accept(event)
      if (done || event.kind !== "session.command_state" || event.command_id !== commandId) return
      if (PROGRESS_STATES.has(event.state)) return
      const response = channel.takeReply(commandId)
      const located = channel.takeLocated(commandId)
      settle()
      resolve({
        outcome: event,
        ...(response === undefined ? {} : { response }),
        ...(located === undefined ? {} : { located }),
      })
    })
    const cancelTimer = timers.after(waitMs, () =>
      fail(new Error(`no final state for endpoint command ${commandId} within ${waitMs} ms`)),
    )
    void client.closed.then(() => fail(new Error("the connection closed before the endpoint command settled")))
    send(commandId).catch(fail)
  })
}

export type { ListingResult, ListingRevision, ReadPage, ReadPageEntry } from "./local-api/client-assembly.ts"
export { LocalApiError } from "./local-api/errors.ts"
export { REFUSED_BEFORE_SENDING } from "./refused-before-sending.ts"
export { NotSentError } from "./not-sent-error.ts"
export { NoPrimaryEndpointError } from "./engine-endpoint.ts"
export type {
  Capability,
  CommandRpc,
  CommandStateEvent,
  ControlAttachState,
  ControlSessionWakeState,
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
export { UnsettledCommandError } from "./unsettled-command.ts"

export { DEVICE_SERVICE_STATE_DIR_ENV, deviceServiceStateDir } from "./state-dir.ts"
// The clock seam, here too so a local-only caller takes it without the package barrel (which reaches the release fetch).
export { realTimers, type Timers } from "./timers.ts"

/** The file a running service publishes in its state dir: the socket on POSIX, the port file on Windows. */
export function deviceServiceEndpointPath(stateDir: string, platform: NodeJS.Platform = process.platform): string {
  return join(stateDir, platform === "win32" ? ENDPOINT_FILE : SOCKET_FILE)
}

/** How long an update record may stay in flight and still explain a missing endpoint (a forced drain plus an install). */
export const UPDATE_IN_FLIGHT_MAX_MS = 15 * 60_000

// The update record's statuses before it settles (relayd machine.update: pending -> trial -> committed | rolled-back | failed).
const UPDATE_IN_FLIGHT: ReadonlySet<unknown> = new Set(["pending", "trial"])

const readRecord = (path: string): Record<string, unknown> | undefined => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

const processAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

/**
 * Why a state dir has no service endpoint (#14172), read from the files the service keeps there (relayd docs
 * device-service.md, "State directory"):
 * - `not_installed`: no adopted identity (`device-identity.json`, erased only by a sign-out), so nothing is set up here.
 * - `restarting`: set up, and a process holds the state (`owner.info` names a live pid) or an update is in flight
 *   (`update/update.json` pending or in trial, started within UPDATE_IN_FLIGHT_MAX_MS): the endpoint is coming back.
 * - `not_running`: set up, but nothing is serving or about to (a crash, a hand stop, a removed unit): retrying alone
 *   does not bring it back.
 */
export function deviceServiceAbsence(stateDir: string, nowMs: number): "not_installed" | "restarting" | "not_running" {
  if (!existsSync(join(stateDir, "device-identity.json"))) return "not_installed"
  const update = readRecord(join(stateDir, "update", "update.json"))
  if (
    update !== undefined &&
    UPDATE_IN_FLIGHT.has(update["status"]) &&
    typeof update["started_ms"] === "number" &&
    nowMs - update["started_ms"] <= UPDATE_IN_FLIGHT_MAX_MS
  )
    return "restarting"
  const owner = readRecord(join(stateDir, "owner.info"))
  const pid = owner?.["pid"]
  return typeof pid === "number" && Number.isInteger(pid) && pid > 0 && processAlive(pid) ? "restarting" : "not_running"
}

export type DeviceService = {
  readonly serviceVersion: string
  /** omo#13037: this service carries the wake mark and the `wake` target (WAKE_MARK_MIN_SERVICE_VERSION). */
  readonly carriesWakeMark: boolean
  /** The service version the mark (and the wake switch) needs on this build; null while this build carries neither. */
  readonly wakeMarkMinimum: string | null
  /** omo#13037: this service takes `session.locate {single: true}` (LOCATE_SINGLE_MIN_SERVICE_VERSION). */
  readonly takesSingleLocate: boolean
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
  /** omo#13037 A7.2.5: the wake switch, read and set through the owner's own local API (never a capability word). */
  readonly sessionWake: () => Promise<ControlSessionWakeState>
  readonly setSessionWake: (enabled: boolean | null) => Promise<ControlSessionWakeState>
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
  readonly sessions: (
    filter?: SessionFilter,
    onRevision?: (revision: ListingRevision) => void,
  ) => Promise<ListingResult>
  readonly attach: (device: string, sessionId: string) => Promise<RemoteAttach>
  /**
   * Sends one session-less engine record (`open_session`, `list_sessions`, ...) to `device`'s engine endpoint with no
   * attach: relay daemon #393's `session.command {device, endpoint, rpc}`, on the device's primary engine endpoint
   * (`engineEndpointOf`, omo#14195); only behind a service older than 0.1.11, which cannot ask, its lone endpoint.
   * Settles like an attach's command: the first command state that is not a progress state, plus the engine's reply.
   * Rejects with the local API's refusal (`unsupported` when the device lists no endpoint, `NoPrimaryEndpointError`
   * when it names none as its own; both before anything is sent), or
   * when the connection closes or no final state arrives within ENDPOINT_COMMAND_WAIT_MS. Every failure before
   * `session.command` is written (the `session.endpoints` lookup, whatever its code) is a `NotSentError` (a
   * `LocalApiError` with `not_sent: true`); a `session.command` that times out after sending carries its `command_id` instead.
   */
  readonly endpointCommand: (
    device: string,
    rpc: CommandRpc,
    options?: EndpointCommandOptions,
  ) => Promise<EndpointCommandResult>
  /**
   * #393 part B's `session.command {session: "<device>.<key>", rpc}`: one engine record to the session `device` lists
   * under `key`, delegated by the device's service with no attach on this connection (one round trip, where an attach
   * then its command takes two). Settles like `endpointCommand`; a refusal before sending is a `NotSentError`.
   */
  readonly sessionCommand: (
    device: string,
    key: string,
    rpc: CommandRpc,
    options?: { readonly waitMs?: number },
  ) => Promise<CommandResult>
  readonly close: () => void
  readonly closed: Promise<void>
  /**
   * #393 part B's `session.locate {device, engine_id}`: the session a create over `device`'s engine endpoint made,
   * found by the durable engine session id in the create reply. `key` is the session's id in the device's listing,
   * the one `attach` takes; the engine id itself is in no listing row.
   */
  readonly locate: (
    device: string,
    engineId: string,
    options?: { readonly single?: boolean },
  ) => Promise<SessionCandidate>
  /**
   * omo#13037: `session.command {wake: {device, durable_id}, rpc}` for a session of `device` that no listing maps; the
   * device service answers it with the receiving consumer's reply or its own refusal (wake_unavailable, session_gone,
   * ambiguous_session) in the outcome's receipt. Rejects `unsupported` before sending toward a device that lacks the
   * feature. Settles like `endpointCommand`.
   */
  readonly wakeCommand: (
    device: string,
    durableId: string,
    rpc: CommandRpc,
    options?: { readonly waitMs?: number },
  ) => Promise<CommandResult>
}

/**
 * `locate`: an `open_session`/`new_session` asks for its new session on the reply (`CommandResult.located`), sparing the
 * session.locate round trip toward a host that names it (decision 0018 amendment 2026-11-06, relay daemon #698).
 */
export type EndpointCommandOptions = {
  readonly locate?: boolean
  /** The endpoint key an earlier command's result named: sent to as is, so no `session.endpoints` lookup runs. */
  readonly endpoint?: string
  /** omo#14130: the caller's bound on the whole command, the endpoint lookup included (default ENDPOINT_COMMAND_WAIT_MS). */
  readonly waitMs?: number
}

/** `endpoint`: the key the command was sent to, so a caller can send the next one there without a lookup. */
export type EndpointCommandResult = CommandResult & { readonly endpoint: string }

export type DeviceCredential = {
  readonly device: DeviceRef
  readonly signingPrivateKey: string
  readonly sealingPrivateKey: string
  /** The account the sign-in belongs to; sent only to a service that accepts it (ADOPT_ACCOUNT_MIN_SERVICE_VERSION). */
  readonly account?: string
}

/**
 * relay-spec ADOPT_ACCOUNT_MIN_SERVICE_VERSION: the first relayd whose device.adopt accepts the optional `account`
 * (omo-relay-daemon#730). 0.1.2 shipped without it, and every older relayd refuses any unknown field, so below 0.1.3
 * device.adopt is sent exactly as before. Gated on welcome.service_version, never on a capability word (design D r9
 * section 3).
 */
export const ADOPT_ACCOUNT_MIN_SERVICE_VERSION = "0.1.3"

const acceptsAdoptAccount = (serviceVersion: string): boolean =>
  compareVersions(serviceVersion, ADOPT_ACCOUNT_MIN_SERVICE_VERSION) >= 0

/**
 * omo#13037 A6 (addenda 1 and 2): the first device service that carries the wake mark (`accepts` on session.command)
 * and the `wake` command target: device-service-v0.1.31 (omo-relay-daemon #1076). Below it neither is ever sent, so
 * every command keeps its bytes. Gated on welcome.service_version, never on a capability word; null would turn both off.
 */
export const WAKE_MARK_MIN_SERVICE_VERSION: string | null = "0.1.31"
/**
 * omo#13037 A4.3.3: the first device service that takes `session.locate {single: true}`: device-service-v0.1.13
 * (omo-relay-daemon #393 part B and #692).
 */
export const LOCATE_SINGLE_MIN_SERVICE_VERSION: string | null = "0.1.13"

const serviceAtLeast = (serviceVersion: string, minimum: string | null): boolean =>
  minimum !== null && compareVersions(serviceVersion, minimum) >= 0

/**
 * Whether a service at `serviceVersion` serves the #13037 delivery protocol (`deliveries.serve` and its family), which
 * arrived with the wake mark (omo-relay-daemon #1076). An older one answers `unknown_type`, and asking again changes nothing.
 */
export const servesDeliveries = (serviceVersion: string): boolean =>
  serviceAtLeast(serviceVersion, WAKE_MARK_MIN_SERVICE_VERSION)

/** The mark this client puts on a peer delivery when its own service carries it. */
export const WAKE_ACCEPTS: readonly "session-wake:v1"[] = ["session-wake:v1"]

export type ConnectDeviceServiceOptions = {
  /** The version of this omo build, reported to the service in its hello. */
  readonly version: string
  readonly stateDir?: string
  /** The connection never keeps the process alive: a long-lived engine-side client, not a CLI verb. */
  readonly background?: boolean
  /** Test seam: the local API connection (the vendored v1 client by default). */
  readonly connect?: (options: ConnectOptions) => Promise<LocalApiClient>
  /**
   * Test seam: the clock every wait of this connection runs on, the local API's handshake and request bounds included.
   * Real timers by default; the local API then keeps its own.
   */
  readonly timers?: Timers
  /** Test seam: the two omo#13037 minimum versions (WAKE_MARK_MIN_SERVICE_VERSION, LOCATE_SINGLE_MIN_SERVICE_VERSION). */
  readonly minimums?: MinimumsOption
}

/** Opens a proven connection to this device's service (mutual proof before any request) and returns the typed SDK. */
export async function connectDeviceService(options: ConnectDeviceServiceOptions): Promise<DeviceService> {
  const stateDir = options.stateDir ?? deviceServiceStateDir()
  const timers = options.timers ?? realTimers
  const deadline = options.timers === undefined ? undefined : deadlineTimerOf(options.timers)
  const client = await (options.connect ?? connectLocalApi)({
    stateDir,
    client: { name: "omo", version: options.version },
    ...(deadline === undefined ? {} : { handshakeTimer: deadline, requestTimer: deadline }),
    ...(options.background === true ? { transport: () => connectLocalBackground(stateDir) } : {}),
  })
  const wakeMarkMinimum = minimumInEffect(options.minimums, "wakeMark", WAKE_MARK_MIN_SERVICE_VERSION)
  const carriesWakeMark = serviceAtLeast(client.welcome.service_version, wakeMarkMinimum)
  const takesSingleLocate = serviceAtLeast(
    client.welcome.service_version,
    minimumInEffect(options.minimums, "singleLocate", LOCATE_SINGLE_MIN_SERVICE_VERSION),
  )
  return {
    serviceVersion: client.welcome.service_version,
    carriesWakeMark,
    wakeMarkMinimum,
    takesSingleLocate,
    capabilities: client.welcome.capabilities,
    initialStatus: client.welcome.state,
    status: () => client.request("status.get", {}),
    watchStatus: async (listener) => {
      const stop = client.onEvent((event) => {
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
    setEnabled: async (enabled) => (await client.request("service.set_enabled", { enabled })).enabled,
    sessionWake: () => client.request("control.session_wake.get", {}),
    setSessionWake: (enabled) => client.request("control.session_wake.set", { enabled }),
    attachControl: () => client.request("control.attach.get", {}),
    setAttachControl: (attached) => client.request("control.attach.set", { attached }),
    registerRefresher: async (binaryPath, version) => {
      await client.request("refresher.register", { binary_path: binaryPath, version })
    },
    adopt: async ({ device, signingPrivateKey, sealingPrivateKey, account }) =>
      (
        await client.request("device.adopt", {
          device,
          signing_private_key: signingPrivateKey,
          sealing_private_key: sealingPrivateKey,
          ...(account !== undefined && acceptsAdoptAccount(client.welcome.service_version) ? { account } : {}),
        })
      ).device,
    registerEndpoints: async (agentDir) => {
      await client.request("endpoints.register", { agent_dir: agentDir })
    },
    forget: async () => {
      await client.request("device.forget", {})
    },
    thisDevice: async () => (await client.request("device.info", {})).device,
    devices: async () => (await client.request("devices.list", {})).devices,
    sessions: newestRowsListing(client),
    // The mark rides only to a service that carries it; below that, every command keeps today's bytes.
    attach: async (device, sessionId) => {
      const attached = await openAttach(client, device, sessionId, timers)
      // Below that only the mark is dropped; the command's own wait still applies.
      return carriesWakeMark
        ? attached
        : {
            ...attached,
            command: (rpc, options) =>
              attached.command(rpc, options?.waitMs === undefined ? undefined : { waitMs: options.waitMs }),
          }
    },
    endpointCommand: async (device, rpc, options) => {
      // The endpoint lookup runs before any session.command is written, so whatever fails it (a timeout, a closed
      // connection, a refusal) dispatched nothing: it is marked not_sent, unlike a timeout after sending.
      const started = timers.now()
      let endpoint = options?.endpoint
      if (endpoint === undefined) {
        const lookup = engineEndpointOf(client, device)
        // omo#14130 review round 5 (L1): a caller's waitMs bounds the lookup itself, not only what follows it.
        const waitMs = options?.waitMs
        const bounded =
          waitMs === undefined
            ? lookup
            : new Promise<Awaited<typeof lookup>>((resolve, reject) => {
                const cancel = timers.after(waitMs, () =>
                  reject(
                    new NotSentError(
                      "request_timeout",
                      "the wait ran out during the endpoint lookup; nothing was sent",
                    ),
                  ),
                )
                lookup.then(
                  (answer) => {
                    cancel()
                    resolve(answer)
                  },
                  (error: unknown) => {
                    cancel()
                    reject(error)
                  },
                )
              })
        try {
          endpoint = await bounded
        } catch (error) {
          throw markNotSent(error)
        }
      }
      // omo#14130 review round 3 (M1): a caller's waitMs covers the lookup too; spent by it, nothing is sent.
      const waitMs = options?.waitMs === undefined ? undefined : options.waitMs - (timers.now() - started)
      if (waitMs !== undefined && waitMs <= 0)
        throw new NotSentError("request_timeout", "the wait ran out during the endpoint lookup; nothing was sent")
      return {
        ...(await sendToEndpoint(client, device, endpoint, rpc, options?.locate === true, timers, waitMs)),
        endpoint,
      }
    },
    sessionCommand: (device, key, rpc, options) =>
      followDelegatedCommand(
        client,
        device,
        timers,
        (commandId) =>
          client.commandTo({ session: `${device}.${key}` }, rpc, commandId).catch((error: unknown) => {
            throw error instanceof LocalApiError && error.command_id === undefined ? markNotSent(error) : error
          }),
        // omo#14130 review round 5 (M1): a caller's bound (a thread tool call's budget) caps the wait.
        options?.waitMs,
      ),
    close: () => client.close(),
    closed: client.closed,
    locate: (device, engineId, options) =>
      client.request("session.locate", {
        device,
        engine_id: engineId,
        ...(options?.single === true && takesSingleLocate ? { single: true as const } : {}),
      }),
    wakeCommand: async (device, durableId, rpc, options) => {
      if (!carriesWakeMark) throw olderThanWakeMinimum(client.welcome.service_version, wakeMarkMinimum)
      return await followDelegatedCommand(
        client,
        device,
        timers,
        (commandId) =>
          client.commandTo({ wake: { device, durable_id: durableId } }, rpc, commandId).catch((error: unknown) => {
            // Only a code that refuses before sending dispatched nothing (#13238 review): `closed` or
            // `protocol_violation` can end a wake already written, so they stay unmarked and the caller reports uncertain.
            throw error instanceof LocalApiError &&
              error.command_id === undefined &&
              REFUSED_BEFORE_SENDING.has(error.code)
              ? markNotSent(error)
              : error
          }),
        options?.waitMs,
      )
    },
  }
}
