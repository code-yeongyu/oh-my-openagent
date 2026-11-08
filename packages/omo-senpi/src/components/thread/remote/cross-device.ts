import { AMBIGUOUS_CANDIDATE_LIMIT, normalizeThreadName, type ThreadCandidate } from "../addressing"
import type { ThreadStatus, ThreadToolResult } from "../contracts"
import { threadToolFailure } from "../errors"
import { threadLink } from "../thread-link"
import type { AliasRegistry, RemoteSessionRow, RemoteThreadSurface } from "./ports"
import { aliasFailure, deviceOnline, locateAcross, openRemote, remoteAvailable } from "./remote-ops"

type LocalEntry = { readonly thread_id: string; readonly name?: string; readonly cwd?: string; readonly preview?: string; readonly updated_at?: string | null; readonly status?: ThreadStatus }
type LocalResolution =
  | { readonly kind: "error"; readonly code: string; readonly candidates?: readonly ThreadCandidate[] }
  | { readonly kind: "ok"; readonly entry: LocalEntry }

export type CrossTarget =
  /** `accountWide`: found through the account (an alias, or an id in the account list), so the workspace scope does not apply. */
  | { readonly kind: "local"; readonly address: string; readonly accountWide?: true }
  | { readonly kind: "remote"; readonly row: RemoteSessionRow }
  | { readonly kind: "error"; readonly result: ThreadToolResult }

/**
 * Frozen order (alias port v1): 1 an exact session id (this device, then the account list), 2 an alias,
 * 3 the name ladder: this device's names and the titles of the account's other devices' live sessions, judged together
 * (#12833), so one match anywhere resolves and two or more are ambiguous_target naming each device. Without a remote
 * surface the tools resolve exactly as before.
 */
export async function crossTarget(remote: RemoteThreadSurface | undefined, address: string, local: LocalResolution): Promise<CrossTarget> {
  if (remote === undefined || address === "self") return { kind: "local", address }
  if (local.kind === "ok" && local.entry.thread_id === address) return { kind: "local", address }
  const unavailable = await remoteAvailable(remote)
  if (unavailable !== undefined) return local.kind === "ok" || unavailable.error.code !== "relay_requires_paid_plan" ? { kind: "local", address } : { kind: "error", result: unavailable }
  let across: Awaited<ReturnType<typeof locateAcross>>
  try {
    across = await locateAcross(remote, address)
  } catch {
    return { kind: "local", address }
  }
  if ("error" in across) return local.kind === "ok" ? { kind: "local", address } : { kind: "error", result: across }
  if (across.where === "remote") return { kind: "remote", row: across.row }
  if (across.where === "here") return { kind: "local", address: across.session_id, accountWide: true }
  return byTitle(across.rows, across.here, address, local)
}

// The local ladder's answers that leave room for a title on another device: nothing here by that name, several here,
// or no workspace to scope it by. Any other answer (an id hit out of scope, an invalid address) stays local.
const NAME_OPEN: ReadonlySet<string> = new Set(["not_found", "ambiguous_target", "caller_context_missing"])

function byTitle(rows: readonly RemoteSessionRow[], here: string | null, address: string, local: LocalResolution): CrossTarget {
  if (local.kind === "error" && !NAME_OPEN.has(local.code)) return { kind: "local", address }
  const wanted = normalizeThreadName(address)
  // A device's ended sessions are reached by id only: a name addresses a live agent, and old runs reuse names.
  const remote = rows.filter((row) => row.device !== here && row.state !== "ended" && normalizeThreadName(row.title) === wanted)
  if (remote.length === 0) return { kind: "local", address }
  const localMatches: readonly ThreadCandidate[] = local.kind === "ok"
    ? [{ id: local.entry.thread_id, name: local.entry.name ?? address, cwd: local.entry.cwd ?? "", preview: local.entry.preview ?? "", updatedAt: local.entry.updated_at ?? null, state: local.entry.status ?? "live" }]
    : local.code === "ambiguous_target" ? (local.candidates ?? []) : []
  if (remote.length === 1 && localMatches.length === 0 && !(local.kind === "error" && local.code === "ambiguous_target")) return { kind: "remote", row: remote[0] }
  // One bounded list that always shows both sides: this device keeps at least half the slots it can fill, the other
  // devices take the rest (the local list already arrives capped at the same limit).
  const localShown = localMatches.slice(0, Math.max(AMBIGUOUS_CANDIDATE_LIMIT - remote.length, Math.min(localMatches.length, AMBIGUOUS_CANDIDATE_LIMIT / 2)))
  const candidates: readonly ThreadCandidate[] = [
    ...localShown.map((candidate) => (here === null ? candidate : { ...candidate, device: here })),
    ...remote.slice(0, AMBIGUOUS_CANDIDATE_LIMIT - localShown.length).map((row) => ({ id: row.session_id, name: row.title, cwd: row.project, preview: "", updatedAt: new Date(row.updated_ms).toISOString(), state: "live" as const, device: row.device })),
  ]
  return {
    kind: "error",
    result: { kind: "error", error: threadToolFailure("ambiguous_target", `Threads on more than one of this account's devices share the name "${address}" (${candidates.length} listed).`, "Call thread_list with all_scope and pass the exact thread_id of the intended thread.", { candidates }) },
  }
}

const ALIASES_UNAVAILABLE: ThreadToolResult = { kind: "error", error: threadToolFailure("host_unavailable", "Thread aliases need the account's alias registry, which this device cannot reach.", "Create or address the thread by its id; retry the alias later.") }

const invalid = (message: string, next: string): ThreadToolResult => ({ kind: "error", error: threadToolFailure("invalid_arguments", message, next) })

async function targetDevice(remote: RemoteThreadSurface, device: string): Promise<{ readonly id?: string } | { readonly result: ThreadToolResult }> {
  const here = await remote.sessions.thisDevice()
  const row = (await remote.sessions.devices()).find((candidate) => candidate.device === device || candidate.label === device)
  if (row !== undefined && row.device === here) return {}
  if (row === undefined) {
    const missing = await deviceOnline(remote, device)
    return { result: missing ?? invalid(`No device ${device}.`, "Call thread_list with all_scope to see the account's devices.") }
  }
  return { id: row.device }
}

export type CreatePlan =
  | { readonly kind: "local"; readonly forkFrom?: string }
  | { readonly kind: "open-local"; readonly address: string }
  | { readonly kind: "done"; readonly result: ThreadToolResult }

/**
 * thread_create under A3: an id or alias OPENS that session wherever it is (never with a device); no id and a
 * device creates on that device; no id and no device creates on this device, as before.
 */
export async function planCreate(
  remote: RemoteThreadSurface | undefined,
  value: { readonly thread?: string; readonly device?: string; readonly fork_from?: string; readonly cwd?: string; readonly name?: string; readonly alias?: string; readonly skills?: readonly string[] },
  local: (address: string) => LocalResolution,
): Promise<CreatePlan> {
  if (value.thread !== undefined && value.device !== undefined) return { kind: "done", result: invalid("An existing thread is named by its id or alias only, never with a device.", "Drop device; the thread's device is found from the account's session list.") }
  if (value.thread !== undefined && value.fork_from !== undefined) return { kind: "done", result: invalid("thread opens an existing thread; fork_from creates a new one. Pass one of them.", "Pass thread to open it, or fork_from to fork it.") }
  if (remote === undefined) {
    if (value.alias !== undefined || (value.device !== undefined)) return { kind: "done", result: { kind: "error", error: threadToolFailure("host_unavailable", "Aliases and other devices need this device signed in to the account's device service.", "Sign in, or create the thread on this device without an alias.") } }
    return value.thread === undefined ? { kind: "local" } : { kind: "open-local", address: value.thread }
  }
  if (value.alias !== undefined) {
    if (remote.aliases === undefined) return { kind: "done", result: ALIASES_UNAVAILABLE }
    const held = await remote.aliases.resolve(value.alias).catch((error: unknown): Awaited<ReturnType<AliasRegistry["resolve"]>> => ({ kind: "error", error: { code: "alias_registry_unavailable", message: `The account's alias registry did not answer: ${error instanceof Error ? error.message : String(error)}.`, details: { reason: "resolve_failed" } } }))
    if (held.kind === "ok") return { kind: "done", result: { kind: "error", error: threadToolFailure("alias_taken", `The alias ${value.alias} is held by another thread.`, "Choose another alias; the holder is named in details.", { holder: held.value }) } }
    if (held.error.code !== "alias_not_found") return { kind: "done", result: aliasFailure(held.error) }
  }
  if (value.thread !== undefined) {
    const target = await crossTarget(remote, value.thread, local(value.thread))
    if (target.kind === "error") return { kind: "done", result: target.result }
    if (target.kind === "remote") return { kind: "done", result: await withAlias(remote, value.alias, await openRemote(remote, { kind: "open", row: target.row }), target.row.device) }
    return { kind: "open-local", address: target.address }
  }
  if (value.fork_from !== undefined) {
    const source = await crossTarget(remote, value.fork_from, local(value.fork_from))
    if (source.kind === "error") return { kind: "done", result: source.result }
    if (source.kind === "remote") {
      if (value.device !== undefined) {
        const wanted = await targetDevice(remote, value.device)
        if ("result" in wanted) return { kind: "done", result: wanted.result }
        if (wanted.id !== source.row.device) return { kind: "done", result: invalid("A fork is created on the device that holds its source thread.", "Drop device, or fork a thread on the device you name.") }
      }
      return { kind: "done", result: await withAlias(remote, value.alias, await openRemote(remote, { kind: "fork", row: source.row, cwd: value.cwd, name: value.name, skills: value.skills }), source.row.device) }
    }
    if (value.device !== undefined) {
      const wanted = await targetDevice(remote, value.device)
      if ("result" in wanted) return { kind: "done", result: wanted.result }
      if (wanted.id !== undefined) return { kind: "done", result: invalid("A fork is created on the device that holds its source thread.", "Drop device, or fork a thread on the device you name.") }
    }
    return { kind: "local", forkFrom: source.address }
  }
  if (value.device === undefined) return { kind: "local" }
  const unavailable = await remoteAvailable(remote)
  if (unavailable !== undefined) return { kind: "done", result: unavailable }
  const target = await targetDevice(remote, value.device)
  if ("result" in target) return { kind: "done", result: target.result }
  if (target.id === undefined) return { kind: "local" }
  return { kind: "done", result: await withAlias(remote, value.alias, await openRemote(remote, { kind: "create", device: target.id, cwd: value.cwd, name: value.name, skills: value.skills }), target.id) }
}

/**
 * Claims the alias for a thread just created. Every failure after the create - a lost race (alias_taken), or the
 * registry or device service failing outright - answers with the created thread named, so it is never orphaned.
 */
export async function withAlias(remote: RemoteThreadSurface | undefined, alias: string | undefined, result: ThreadToolResult, device?: string): Promise<ThreadToolResult> {
  if (remote?.aliases === undefined || alias === undefined || result.kind !== "ok" || !("thread" in result)) return result
  let claimed: Awaited<ReturnType<AliasRegistry["claim"]>>
  try {
    const holderDevice = device ?? (await remote.sessions.thisDevice()) ?? ""
    claimed = await remote.aliases.claim({ alias, holder: { session_id: result.thread.thread_id, device: holderDevice }, idempotency_key: `create:${result.thread.thread_id}` })
  } catch (error) {
    claimed = { kind: "error", error: { code: "alias_registry_unavailable", message: `The thread was created, but its alias could not be claimed: ${error instanceof Error ? error.message : String(error)}.`, details: { reason: "claim_failed" } } }
  }
  if (claimed.kind === "error") {
    const failed = aliasFailure(claimed.error)
    return { kind: "error", error: { ...failed.error, details: { ...(failed.error.details ?? {}), thread_id: result.thread.thread_id } } }
  }
  return { ...result, thread: { ...result.thread, alias: claimed.value.alias } } as ThreadToolResult
}

/** thread_rename's alias half: claim when the thread holds none, else an atomic rename; a duplicate is alias_taken. */
export async function renameAlias(remote: RemoteThreadSurface | undefined, threadId: string, device: string | undefined, alias: string, key: string): Promise<ThreadToolResult | undefined> {
  if (remote?.aliases === undefined) return ALIASES_UNAVAILABLE
  const current = await remote.aliases.aliasesOf([threadId])
  if (current.kind === "error") return aliasFailure(current.error)
  const from = current.value.get(threadId)
  const holderDevice = device ?? (await remote.sessions.thisDevice()) ?? ""
  const changed = from === undefined
    ? await remote.aliases.claim({ alias, holder: { session_id: threadId, device: holderDevice }, idempotency_key: key })
    : await remote.aliases.rename({ session_id: threadId, from, to: alias, idempotency_key: key })
  return changed.kind === "error" ? aliasFailure(changed.error) : undefined
}

/** thread_list with all_scope: this device's threads plus the account's other devices' (each with its device), with aliases. */
export async function listAcross(remote: RemoteThreadSurface | undefined, local: ThreadToolResult, allScope: boolean): Promise<ThreadToolResult> {
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
  const others = listed.filter((row) => row.device !== here && !known.has(row.session_id))
  const merged: ThreadToolResult = {
    ...local,
    threads: [
      ...local.threads,
      ...others.map((row) => ({ thread_id: row.session_id, name: row.title, status: "live" as const, cwd: row.project, created_at: new Date(row.updated_ms).toISOString(), updated_at: new Date(row.updated_ms).toISOString(), device: row.device, link: threadLink(row.session_id, row.title) })),
    ],
  }
  return withAliases(remote, merged, [...ids, ...others.map((row) => row.session_id)])
}

async function withAliases(remote: RemoteThreadSurface, listed: ThreadToolResult, ids: readonly string[]): Promise<ThreadToolResult> {
  if (remote.aliases === undefined || listed.kind !== "ok" || !("threads" in listed) || ids.length === 0) return listed
  let aliases: Awaited<ReturnType<AliasRegistry["aliasesOf"]>>
  try {
    aliases = await remote.aliases.aliasesOf(ids)
  } catch {
    return listed
  }
  if (aliases.kind === "error") return listed
  return { ...listed, threads: listed.threads.map((thread) => { const alias = aliases.value.get(thread.thread_id); return alias === undefined ? thread : { ...thread, alias } }) }
}
