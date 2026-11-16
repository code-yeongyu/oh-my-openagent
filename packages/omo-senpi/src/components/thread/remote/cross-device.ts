import { AMBIGUOUS_CANDIDATE_LIMIT, normalizeThreadName, type ThreadCandidate } from "../addressing"
import type { ThreadLocalAliasNote, ThreadStatus, ThreadToolResult } from "../contracts"
import { createRelaySessionHost, listedThread } from "../control/relay-session-host"
import type { HostedThread, SessionHost, SessionOpenRequest } from "../control/session-host"
import { threadToolFailure } from "../errors"
import {
  rowThreadId,
  type AliasError,
  type AliasRegistry,
  type RemoteSessionRow,
  type RemoteThreadSurface,
} from "./ports"
import { aliasFailure, deviceOnline, remoteAvailable } from "./remote-ops"

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

async function targetDevice(
  remote: RemoteThreadSurface,
  device: string,
): Promise<{ readonly id?: string } | { readonly result: ThreadToolResult }> {
  const here = await remote.sessions.thisDevice()
  const row = (await remote.sessions.devices()).find(
    (candidate) => candidate.device === device || candidate.label === device,
  )
  if (row !== undefined && row.device === here) return {}
  if (row === undefined) {
    const missing = await deviceOnline(remote, device)
    return {
      result:
        missing ?? invalid(`No device ${device}.`, "Call thread_list with all_scope to see the account's devices."),
    }
  }
  return { id: row.device }
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

const signedOut = (error: AliasError): boolean =>
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
  result: { kind: "ok", thread, deduplicated: true },
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
            { holder: held.value },
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
    // A device's listing names its ended sessions too; only those are opened again, from their file (B's engine holds a live one).
    if (target.row.state !== "ended") return alreadyLive(listedThread(target.row), target.row.device)
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

/**
 * Claims the alias for a thread just created. Every failure after the create - a lost race (alias_taken), or the
 * registry or device service failing outright - answers with the created thread named, so it is never orphaned.
 */
export async function withAlias(
  remote: RemoteThreadSurface | undefined,
  alias: string | undefined,
  result: ThreadToolResult,
  device?: string,
): Promise<ThreadToolResult> {
  const claimed = await claimCreatedAlias(remote, alias, result, device, false)
  return "local" in claimed ? result : claimed
}

/**
 * withAlias for a thread this call just created: an account gone by the claim (`sign_in`, e.g. a token that expired
 * after the resolve) answers `{ local: "sign_in" }` instead of a failure, so the caller names the thread by the alias
 * on its device, exactly as when no account was there to begin with (#13104).
 */
export async function claimCreatedAlias(
  remote: RemoteThreadSurface | undefined,
  alias: string | undefined,
  result: ThreadToolResult,
  device?: string,
  localWhenSignedOut = true,
): Promise<ThreadToolResult | { readonly local: "sign_in" }> {
  if (remote?.aliases === undefined || alias === undefined || result.kind !== "ok" || !("thread" in result))
    return result
  let claimed: Awaited<ReturnType<AliasRegistry["claim"]>>
  try {
    const holderDevice = device ?? (await remote.sessions.thisDevice()) ?? ""
    claimed = await remote.aliases.claim({
      alias,
      holder: { session_id: result.thread.thread_id, device: holderDevice },
      idempotency_key: `create:${result.thread.thread_id}`,
    })
  } catch (error) {
    claimed = {
      kind: "error",
      error: {
        code: "alias_registry_unavailable",
        message: `The thread was created, but its alias could not be claimed: ${error instanceof Error ? error.message : String(error)}.`,
        details: { reason: "claim_failed" },
      },
    }
  }
  if (claimed.kind === "error") {
    if (localWhenSignedOut && signedOut(claimed.error)) return { local: "sign_in" }
    const failed = aliasFailure(claimed.error)
    return {
      kind: "error",
      error: { ...failed.error, details: { ...(failed.error.details ?? {}), thread_id: result.thread.thread_id } },
    }
  }
  return { ...result, thread: { ...result.thread, alias: claimed.value.alias } } as ThreadToolResult
}

/**
 * thread_rename's alias half: claim when the thread holds none, else an atomic rename; a duplicate is alias_taken. With
 * no account to hold it (#13104) it changes nothing and answers `local`, so the caller can make the alias the name.
 */
export async function renameAlias(
  remote: RemoteThreadSurface | undefined,
  threadId: string,
  device: string | undefined,
  alias: string,
  key: string,
): Promise<ThreadToolResult | { readonly local: LocalAliasReason } | undefined> {
  if (remote === undefined) return { local: "no_remote" }
  if (remote.aliases === undefined) return { local: "no_registry" }
  const current = await remote.aliases.aliasesOf([threadId])
  if (current.kind === "error") return signedOut(current.error) ? { local: "sign_in" } : aliasFailure(current.error)
  const from = current.value.get(threadId)
  const holderDevice = device ?? (await remote.sessions.thisDevice()) ?? ""
  const changed =
    from === undefined
      ? await remote.aliases.claim({
          alias,
          holder: { session_id: threadId, device: holderDevice },
          idempotency_key: key,
        })
      : await remote.aliases.rename({ session_id: threadId, from, to: alias, idempotency_key: key })
  if (changed.kind !== "error") return undefined
  // The account can be gone by the claim or rename even when aliasesOf answered (a token that expired in between).
  return signedOut(changed.error) ? { local: "sign_in" } : aliasFailure(changed.error)
}

/** thread_list with all_scope: this device's threads plus the account's other devices' (each with its device), with aliases. */
export async function listAcross(
  remote: RemoteThreadSurface | undefined,
  local: ThreadToolResult,
  allScope: boolean,
): Promise<ThreadToolResult> {
  if (remote === undefined || local.kind !== "ok" || !("threads" in local)) return local
  const ids = local.threads.map((thread) => thread.thread_id)
  const unavailable = await remoteAvailable(remote)
  if (!allScope) return unavailable === undefined ? withAliases(remote, local, ids) : local
  if (unavailable !== undefined) return { ...local, remote_unavailable: unavailable.error.code }
  const here = await remote.sessions.thisDevice()
  const known = new Set(ids)
  let listed: readonly RemoteSessionRow[]
  try {
    listed = await remote.sessions.sessions()
  } catch {
    return withAliases(remote, { ...local, remote_unavailable: "host_unavailable" }, ids)
  }
  const others = listed.filter((row) => row.device !== here && !known.has(rowThreadId(row)))
  const merged: ThreadToolResult = {
    ...local,
    threads: [
      ...local.threads,
      ...others.map((row) => {
        const { sessionId: _routing, ...thread } = listedThread(row)
        return thread
      }),
    ],
  }
  return withAliases(remote, merged, [...ids, ...others.map(rowThreadId).filter((id) => id !== "")])
}

async function withAliases(
  remote: RemoteThreadSurface,
  listed: ThreadToolResult,
  ids: readonly string[],
): Promise<ThreadToolResult> {
  if (remote.aliases === undefined || listed.kind !== "ok" || !("threads" in listed) || ids.length === 0) return listed
  let aliases: Awaited<ReturnType<AliasRegistry["aliasesOf"]>>
  try {
    aliases = await remote.aliases.aliasesOf(ids)
  } catch {
    return listed
  }
  if (aliases.kind === "error") return listed
  return {
    ...listed,
    threads: listed.threads.map((thread) => {
      const alias = aliases.value.get(thread.thread_id)
      return alias === undefined ? thread : { ...thread, alias }
    }),
  }
}
