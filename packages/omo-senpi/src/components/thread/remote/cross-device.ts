import type { ThreadToolResult } from "../contracts"
import { threadToolFailure } from "../errors"
import { threadLink } from "../thread-link"
import type { RemoteSessionRow, RemoteThreadSurface } from "./ports"
import { aliasFailure, deviceOnline, locateAcross, openRemote, remoteAvailable } from "./remote-ops"

type LocalResolution = { readonly kind: "error"; readonly code: string } | { readonly kind: "ok"; readonly entry: { readonly thread_id: string } }

export type CrossTarget =
  | { readonly kind: "local"; readonly address: string }
  | { readonly kind: "remote"; readonly row: RemoteSessionRow }
  | { readonly kind: "error"; readonly result: ThreadToolResult }

/**
 * Frozen order (alias port v1): 1 an exact session id (this device, then the account list), 2 an alias,
 * 3 today's local name ladder. Without a remote surface the tools resolve exactly as before.
 */
export async function crossTarget(remote: RemoteThreadSurface | undefined, address: string, local: LocalResolution): Promise<CrossTarget> {
  if (remote === undefined || address === "self") return { kind: "local", address }
  if (local.kind === "ok" && local.entry.thread_id === address) return { kind: "local", address }
  const unavailable = await remoteAvailable(remote)
  if (unavailable !== undefined) return local.kind === "ok" ? { kind: "local", address } : { kind: "error", result: unavailable }
  const across = await locateAcross(remote, address)
  if ("error" in across) return { kind: "error", result: across }
  if (across.where === "remote") return { kind: "remote", row: across.row }
  if (across.where === "here") return { kind: "local", address: across.session_id }
  return { kind: "local", address }
}

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
  | { readonly kind: "local" }
  | { readonly kind: "open-local"; readonly address: string }
  | { readonly kind: "done"; readonly result: ThreadToolResult }

/**
 * thread_create under A3: an id or alias OPENS that session wherever it is (never with a device); no id and a
 * device creates on that device; no id and no device creates on this device, as before.
 */
export async function planCreate(
  remote: RemoteThreadSurface | undefined,
  value: { readonly thread?: string; readonly device?: string; readonly fork_from?: string; readonly cwd?: string; readonly name?: string; readonly alias?: string },
  local: (address: string) => LocalResolution,
): Promise<CreatePlan> {
  if (value.thread !== undefined && value.device !== undefined) return { kind: "done", result: invalid("An existing thread is named by its id or alias only, never with a device.", "Drop device; the thread's device is found from the account's session list.") }
  if (value.thread !== undefined && value.fork_from !== undefined) return { kind: "done", result: invalid("thread opens an existing thread; fork_from creates a new one. Pass one of them.", "Pass thread to open it, or fork_from to fork it.") }
  if (remote === undefined) {
    if (value.alias !== undefined || (value.device !== undefined)) return { kind: "done", result: { kind: "error", error: threadToolFailure("host_unavailable", "Aliases and other devices need this device signed in to the account's device service.", "Sign in, or create the thread on this device without an alias.") } }
    return value.thread === undefined ? { kind: "local" } : { kind: "open-local", address: value.thread }
  }
  if (value.alias !== undefined) {
    const held = await remote.aliases.resolve(value.alias)
    if (held.kind === "ok") return { kind: "done", result: { kind: "error", error: threadToolFailure("alias_taken", `The alias ${value.alias} is held by another thread.`, "Choose another alias; the holder is named in details.", { holder: held.value }) } }
    if (held.error.code !== "alias_not_found") return { kind: "done", result: aliasFailure(held.error) }
  }
  if (value.thread !== undefined) {
    const target = await crossTarget(remote, value.thread, local(value.thread))
    if (target.kind === "error") return { kind: "done", result: target.result }
    if (target.kind === "remote") return { kind: "done", result: await openRemote(remote, { kind: "open", row: target.row }) }
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
      return { kind: "done", result: await withAlias(remote, value.alias, await openRemote(remote, { kind: "fork", row: source.row, cwd: value.cwd, name: value.name }), source.row.device) }
    }
  }
  if (value.device === undefined) return { kind: "local" }
  const unavailable = await remoteAvailable(remote)
  if (unavailable !== undefined) return { kind: "done", result: unavailable }
  const target = await targetDevice(remote, value.device)
  if ("result" in target) return { kind: "done", result: target.result }
  if (target.id === undefined) return { kind: "local" }
  return { kind: "done", result: await withAlias(remote, value.alias, await openRemote(remote, { kind: "create", device: target.id, cwd: value.cwd, name: value.name }), target.id) }
}

/** Claims the alias for a thread just created; a lost race answers alias_taken with the created thread named. */
export async function withAlias(remote: RemoteThreadSurface | undefined, alias: string | undefined, result: ThreadToolResult, device?: string): Promise<ThreadToolResult> {
  if (remote === undefined || alias === undefined || result.kind !== "ok" || !("thread" in result)) return result
  const holderDevice = device ?? (await remote.sessions.thisDevice()) ?? ""
  const claimed = await remote.aliases.claim({ alias, holder: { session_id: result.thread.thread_id, device: holderDevice }, idempotency_key: `create:${result.thread.thread_id}` })
  if (claimed.kind === "error") {
    const failed = aliasFailure(claimed.error)
    return { kind: "error", error: { ...failed.error, details: { ...(failed.error.details ?? {}), thread_id: result.thread.thread_id } } }
  }
  return { ...result, thread: { ...result.thread, alias: claimed.value.alias } } as ThreadToolResult
}

/** thread_rename's alias half: claim when the thread holds none, else an atomic rename; a duplicate is alias_taken. */
export async function renameAlias(remote: RemoteThreadSurface | undefined, threadId: string, device: string | undefined, alias: string, key: string): Promise<ThreadToolResult | undefined> {
  if (remote === undefined) return { kind: "error", error: threadToolFailure("host_unavailable", "Aliases need this device signed in to the account's device service.", "Sign in, then retry.") }
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
  if (!allScope) return withAliases(remote, local, ids)
  const unavailable = await remoteAvailable(remote)
  if (unavailable !== undefined) return { ...local, remote_unavailable: unavailable.error.code }
  const here = await remote.sessions.thisDevice()
  const known = new Set(ids)
  const others = (await remote.sessions.sessions()).filter((row) => row.device !== here && !known.has(row.session_id))
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
  if (listed.kind !== "ok" || !("threads" in listed) || ids.length === 0) return listed
  const aliases = await remote.aliases.aliasesOf(ids)
  if (aliases.kind === "error") return listed
  return { ...listed, threads: listed.threads.map((thread) => { const alias = aliases.value.get(thread.thread_id); return alias === undefined ? thread : { ...thread, alias } }) }
}
