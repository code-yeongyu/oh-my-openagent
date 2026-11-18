import { AMBIGUOUS_CANDIDATE_LIMIT, normalizeThreadName, type ThreadCandidate } from "../addressing"
import type { ThreadLocalAliasNote, ThreadStatus, ThreadToolResult } from "../contracts"
import { createRelaySessionHost, listedThread } from "../control/relay-session-host"
import type { HostedThread, SessionHost, SessionOpenRequest } from "../control/session-host"
import { threadToolFailure } from "../errors"
import { openedResult } from "../tools/thread-row"
import {
  rowStatus,
  type AliasError,
  type AliasRegistry,
  type RemoteDevice,
  type RemoteSessionRow,
  type RemoteThreadSurface,
} from "./ports"
import { accountDevices } from "./account"
import { aliasFailure, holderDetails, remoteAvailable } from "./remote-ops"

type LocalEntry = {
  readonly thread_id: string
  readonly name?: string
  readonly cwd?: string
  readonly preview?: string
  readonly updated_at?: string | null
  readonly status?: ThreadStatus
}
type LocalResolution =
  | { readonly kind: "error"; readonly code: string; readonly candidates?: readonly ThreadCandidate[] }
  | { readonly kind: "ok"; readonly entry: LocalEntry }

export type CrossTarget =
  /** `accountWide`: found through the account (an alias, or an id in the account list), so the workspace scope does not apply. */
  | { readonly kind: "local"; readonly address: string; readonly accountWide?: true }
  | { readonly kind: "remote"; readonly row: RemoteSessionRow }
  | { readonly kind: "error"; readonly result: ThreadToolResult }

const ALIASES_UNAVAILABLE: ThreadToolResult = {
  kind: "error",
  error: threadToolFailure(
    "host_unavailable",
    "Thread aliases need the account's alias registry, which this device cannot reach.",
    "Create or address the thread by its id; retry the alias later.",
  ),
}

const invalid = (message: string, next: string): ThreadToolResult => ({
  kind: "error",
  error: threadToolFailure("invalid_arguments", message, next),
})

/** The shortest device id prefix a create accepts: shorter would match most of an account's ids by chance. */
const DEVICE_PREFIX_MIN = 6

const deviceCandidates = (rows: readonly RemoteDevice[]) =>
  rows.slice(0, AMBIGUOUS_CANDIDATE_LIMIT).map((row) => ({ device: row.device, name: row.label, online: row.online }))

const deviceFailure = (
  code: "not_found" | "ambiguous_target" | "device_offline",
  message: string,
  next: string,
  device: string,
  rows: readonly RemoteDevice[],
): { readonly result: ThreadToolResult } => ({
  result: {
    kind: "error",
    error: threadToolFailure(code, message, next, { device, candidates: deviceCandidates(rows) }),
  },
})

/**
 * The account device a create names (#14072): its exact id, else its display name (the machine name thread_list shows as
 * `machine`, compared as thread names are), else a unique id prefix. Of the rows sharing a name the online ones count, so
 * an offline twin a re-registered machine left behind never shadows the live device; several online is ambiguous_target,
 * only offline ones device_offline. A name or prefix nothing matches is not_found listing the account's devices.
 */
function resolveDevice(
  devices: readonly RemoteDevice[],
  address: string,
): { readonly row: RemoteDevice } | { readonly result: ThreadToolResult } {
  const byId = devices.find((row) => row.device === address)
  if (byId !== undefined) return { row: byId }
  const wanted = normalizeThreadName(address)
  const named = devices.filter((row) => normalizeThreadName(row.label) === wanted)
  const online = named.filter((row) => row.online)
  const [only] = online.length > 0 ? online : named
  if (online.length === 1 && only !== undefined) return { row: only }
  if (online.length > 1)
    return deviceFailure(
      "ambiguous_target",
      `${online.length} online devices are named ${address}; none was picked.`,
      "Pass the device id from candidates.",
      address,
      online,
    )
  if (only !== undefined)
    return deviceFailure(
      "device_offline",
      `Device ${address} is offline.`,
      "Retry when that device is online; nothing was queued.",
      address,
      named,
    )
  const prefix =
    wanted.length >= DEVICE_PREFIX_MIN ? devices.filter((row) => row.device.toLowerCase().startsWith(wanted)) : []
  const [match] = prefix
  if (prefix.length === 1 && match !== undefined) return { row: match }
  if (prefix.length > 1)
    return deviceFailure(
      "ambiguous_target",
      `${prefix.length} devices have an id starting ${address}; none was picked.`,
      "Pass more of the device id, or its name.",
      address,
      prefix,
    )
  return deviceFailure(
    "not_found",
    `No device named ${address} is signed in to this account.`,
    "Pass a device name or id from candidates, or call thread_list with all_scope.",
    address,
    devices,
  )
}

async function targetDevice(
  remote: RemoteThreadSurface,
  device: string,
): Promise<{ readonly id?: string } | { readonly result: ThreadToolResult }> {
  const { here, devices } = await accountDevices(remote.client)
  const resolved = resolveDevice(devices, device)
  if ("result" in resolved) return resolved
  return resolved.row.device === here ? {} : { id: resolved.row.device }
}

/** What this device answers for an existing thread named to thread_create: it is live here, or its session file is here, or neither. */
export type LocalExisting =
  | { readonly kind: "live"; readonly thread: HostedThread }
  | { readonly kind: "file"; readonly sessionPath: string }
  | { readonly kind: "error"; readonly result: ThreadToolResult }

/** This device's side of placement: its name ladder, what it knows of an existing thread, and its SessionHost. */
export type LocalPlacement = {
  readonly host: SessionHost
  /**
   * The calling session's folder. A new thread this device creates with no `cwd` starts there, in its creator's scope
   * (a project folder, or the desktop's own folder for a thread with no project), never in the folder the engine
   * process happens to run in. Absent when the caller's folder is unknown.
   */
  readonly callerCwd?: string
  readonly resolve: (address: string) => LocalResolution
  /** Decision 0027: the ONE resolver (local + relay address books) for an existing thread or a fork source; omitted = local only. */
  readonly locate: (address: string) => Promise<CrossTarget>
  readonly existing: (address: string) => LocalExisting
}

/**
 * Where a thread_create lands: `open` names the SessionHost that opens it and the open's own fields (`creates` is false
 * for an existing thread's file); `done` is a refusal, or an existing thread that is live already and needs no open
 * (`deduplicated`), with the device that holds it.
 */
type OpenFields = Pick<SessionOpenRequest, "cwd" | "sessionPath" | "forkFrom">

/**
 * Why an alias stays the thread's name on its own device (#13104): no account holds it - the registry asks for a sign-in
 * (a desktop launch always does), this surface has no registry, or there is no remote surface at all.
 */
export type LocalAliasReason = NonNullable<ThreadLocalAliasNote["alias_unavailable"]>

export const signedOut = (error: AliasError): boolean =>
  error.code === "alias_registry_unavailable" && error.details?.reason === "sign_in"

/** `localAlias`: the alias is not account-wide; the create names the thread by it unless a name was given. */
export type CreatePlan =
  | {
      readonly kind: "open"
      readonly host: SessionHost
      readonly request: OpenFields
      readonly creates: boolean
      readonly localAlias?: LocalAliasReason
    }
  | { readonly kind: "done"; readonly result: ThreadToolResult; readonly device?: string }

const alreadyLive = (thread: HostedThread, device?: string): CreatePlan => ({
  kind: "done",
  result: openedResult(thread, true),
  ...(device === undefined ? {} : { device }),
})

/**
 * thread_create under A3: an id or alias OPENS that session wherever it is (never with a device) - answered without an
 * open when it is live there already; no id and a device creates on that device; no id and no device creates on this
 * device, as before; a fork is created on its source's device. Placement is the only step that reads the device.
 */
export async function planCreate(
  remote: RemoteThreadSurface | undefined,
  value: {
    readonly thread?: string
    readonly device?: string
    readonly fork_from?: string
    readonly cwd?: string
    readonly alias?: string
  },
  local: LocalPlacement,
): Promise<CreatePlan> {
  const here = (request: OpenFields, creates: boolean): CreatePlan => ({
    kind: "open",
    host: local.host,
    request,
    creates,
  })
  const create = (host: SessionHost): CreatePlan => {
    // Another device never sees this caller's folder, so only a create here inherits it.
    const cwd = value.cwd ?? (host === local.host ? local.callerCwd : undefined)
    return { kind: "open", host, request: cwd === undefined ? {} : { cwd }, creates: true }
  }
  const openHere = (address: string): CreatePlan => {
    const existing = local.existing(address)
    if (existing.kind === "error") return { kind: "done", result: existing.result }
    return existing.kind === "live" ? alreadyLive(existing.thread) : here({ sessionPath: existing.sessionPath }, false)
  }
  if (value.thread !== undefined && value.device !== undefined)
    return {
      kind: "done",
      result: invalid(
        "An existing thread is named by its id or alias only, never with a device.",
        "Drop device; the thread's device is found from the account's session list.",
      ),
    }
  if (value.thread !== undefined && value.fork_from !== undefined)
    return {
      kind: "done",
      result: invalid(
        "thread opens an existing thread; fork_from creates a new one. Pass one of them.",
        "Pass thread to open it, or fork_from to fork it.",
      ),
    }
  if (remote === undefined) {
    if (value.device !== undefined || (value.alias !== undefined && value.thread !== undefined))
      return {
        kind: "done",
        result: {
          kind: "error",
          error: threadToolFailure(
            "host_unavailable",
            "Aliases and other devices need this device signed in to the account's device service.",
            "Sign in, or create the thread on this device without an alias.",
          ),
        },
      }
    if (value.thread !== undefined) return openHere(value.thread)
    const plan =
      value.fork_from === undefined
        ? create(local.host)
        : here({ ...(value.cwd === undefined ? {} : { cwd: value.cwd }), forkFrom: value.fork_from }, true)
    return value.alias === undefined || plan.kind !== "open" ? plan : { ...plan, localAlias: "no_remote" }
  }
  // An alias no account can hold is the new thread's local name (#13104); opening an existing thread by it still needs the account.
  let localAlias: LocalAliasReason | undefined
  const scoped = (plan: CreatePlan): CreatePlan =>
    localAlias === undefined || plan.kind !== "open" ? plan : { ...plan, localAlias }
  if (value.alias !== undefined && remote.aliases === undefined) {
    if (value.thread !== undefined) return { kind: "done", result: ALIASES_UNAVAILABLE }
    localAlias = "no_registry"
  } else if (value.alias !== undefined && remote.aliases !== undefined) {
    const held = await remote.aliases
      .resolve(value.alias)
      .catch((error: unknown): Awaited<ReturnType<AliasRegistry["resolve"]>> => ({
        kind: "error",
        error: {
          code: "alias_registry_unavailable",
          message: `The account's alias registry did not answer: ${error instanceof Error ? error.message : String(error)}.`,
          details: { reason: "resolve_failed" },
        },
      }))
    if (held.kind === "ok")
      return {
        kind: "done",
        result: {
          kind: "error",
          error: threadToolFailure(
            "alias_taken",
            `The alias ${value.alias} is held by another thread.`,
            "Choose another alias; the holder is named in details.",
            { holder: holderDetails(held.value) },
          ),
        },
      }
    if (held.error.code !== "alias_not_found") {
      if (value.thread !== undefined || !signedOut(held.error))
        return { kind: "done", result: aliasFailure(held.error) }
      localAlias = "sign_in"
    }
  }
  if (value.thread !== undefined) {
    const target = await local.locate(value.thread)
    if (target.kind === "error") return { kind: "done", result: target.result }
    if (target.kind === "local") return openHere(target.address)
    // Only a row its device listed live this round is answered as already live (B's engine holds it). An ended row, or a
    // cached snapshot of a device that did not answer (#14043), is opened again from its file; the relay host refuses
    // that open device_offline while the device stays offline.
    if (rowStatus(target.row) === "live") return alreadyLive(listedThread(target.row), target.row.device)
    return {
      kind: "open",
      host: createRelaySessionHost(remote, target.row.device, target.row),
      request: { sessionPath: target.row.path },
      creates: false,
    }
  }
  if (value.fork_from !== undefined) {
    const source = await local.locate(value.fork_from)
    if (source.kind === "error") return { kind: "done", result: source.result }
    if (value.device !== undefined) {
      const wanted = await targetDevice(remote, value.device)
      if ("result" in wanted) return { kind: "done", result: wanted.result }
      if (wanted.id !== (source.kind === "remote" ? source.row.device : undefined))
        return {
          kind: "done",
          result: invalid(
            "A fork is created on the device that holds its source thread.",
            "Drop device, or fork a thread on the device you name.",
          ),
        }
    }
    // The far engine opens a fork by the id IT knows the source under: its durable id (the listing key is the relay's).
    const fork = {
      ...(value.cwd === undefined ? {} : { cwd: value.cwd }),
      forkFrom: source.kind === "remote" ? (source.row.durable_id ?? source.row.session_id) : source.address,
    }
    return scoped(
      source.kind === "remote"
        ? { kind: "open", host: createRelaySessionHost(remote, source.row.device), request: fork, creates: true }
        : here(fork, true),
    )
  }
  if (value.device === undefined) return scoped(create(local.host))
  const unavailable = await remoteAvailable(remote)
  if (unavailable !== undefined) return { kind: "done", result: unavailable }
  const target = await targetDevice(remote, value.device)
  if ("result" in target) return { kind: "done", result: target.result }
  return scoped(create(target.id === undefined ? local.host : createRelaySessionHost(remote, target.id)))
}
