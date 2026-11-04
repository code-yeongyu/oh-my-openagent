import type { ThreadToolResult } from "../contracts"
import { threadToolFailure, type ThreadToolFailure } from "../errors"
import { threadLink } from "../thread-link"
import { transcriptRole } from "../tools/internals"
import type { AliasError, AliasHolder, JsonObject, RemoteCommandOutcome, RemoteSessionRow, RemoteThreadSurface } from "./ports"

type Failure = { readonly kind: "error"; readonly error: ThreadToolFailure }
const fail = (code: ThreadToolFailure["code"], message: string, next: string, details?: Readonly<Record<string, unknown>>): Failure => ({ kind: "error", error: threadToolFailure(code, message, next, details) })

/** A5: the relay is paid only; on any other plan the remote path answers this, never a silent failure or a queue. */
export async function remoteAvailable(remote: RemoteThreadSurface): Promise<Failure | undefined> {
  const { state } = await remote.sessions.status()
  if (state === "plan_required") return fail("relay_requires_paid_plan", "Reaching sessions on other devices needs a paid plan; this account's plan has no relay.", "Upgrade the plan to use other devices, or work with threads on this device.")
  return undefined
}

export function outcomeFailure(outcome: Exclude<RemoteCommandOutcome, { readonly kind: "ok" }>, device: string): Failure {
  if (outcome.kind === "uncertain") return fail("idempotency_uncertain", `The command to device ${device} may or may not have run (${outcome.reason}).`, "Read the thread before deciding whether to retry.", { device, reason: outcome.reason })
  if (outcome.reason === "capability_missing") return fail("scope_denied", `Device ${device} does not grant this command.`, "Allow commands from this device on the other device, then retry.", { device, reason: outcome.reason })
  if (outcome.reason === "host_detached") return fail("host_unavailable", `Device ${device} is not attached to the relay.`, "Retry when that device is signed in and online.", { device, reason: outcome.reason })
  return fail("unsupported", `Device ${device} refused the command (${outcome.reason}).`, "Update omo on that device, or address a thread on this device.", { device, reason: outcome.reason })
}

export function aliasFailure(error: AliasError): Failure {
  if (error.code === "alias_taken") return fail("alias_taken", error.message, "Choose another alias; the holder is named in details.", error.details?.holder === undefined ? undefined : { holder: error.details.holder })
  if (error.code === "alias_invalid") return fail("invalid_arguments", error.message, "Use 1-64 visible characters that do not look like a session id.", { reason: error.details?.reason })
  if (error.code === "alias_not_found") return fail("not_found", error.message, "Call thread_list to see the threads and their aliases.")
  return fail("host_unavailable", error.message, "Retry when the account service is reachable.", { reason: error.details?.reason })
}

/** Where a session address points once the account is consulted (A3): another device's session, or this device. */
export type RemoteTarget =
  | { readonly where: "remote"; readonly row: RemoteSessionRow }
  | { readonly where: "here"; readonly session_id: string }
  | { readonly where: "none" }

/**
 * Resolution steps 1b and 2 of the frozen order: an exact session id in the account list, then an alias.
 * Step 1a (this device's exact id) and step 3 (the local name ladder) stay with the local resolver.
 */
export async function locateAcross(remote: RemoteThreadSurface, address: string): Promise<RemoteTarget | Failure> {
  const here = await remote.sessions.thisDevice()
  const rows = await remote.sessions.sessions()
  const byId = rows.find((row) => row.session_id === address)
  if (byId !== undefined) return byId.device === here ? { where: "here", session_id: byId.session_id } : { where: "remote", row: byId }
  const alias = await remote.aliases.resolve(address)
  if (alias.kind === "error") {
    if (alias.error.code === "alias_not_found" || alias.error.code === "alias_invalid") return { where: "none" }
    return aliasFailure(alias.error)
  }
  return holderTarget(alias.value, here, rows)
}

function holderTarget(holder: AliasHolder, here: string | null, rows: readonly RemoteSessionRow[]): RemoteTarget | Failure {
  if (holder.device === here) return { where: "here", session_id: holder.session_id }
  const row = rows.find((candidate) => candidate.device === holder.device && candidate.session_id === holder.session_id)
  if (row === undefined) return fail("device_offline", `Device ${holder.device} holding this thread is offline.`, "Retry when that device is online; nothing was queued.", { device: holder.device, thread_id: holder.session_id })
  return { where: "remote", row }
}

/** A typed `device_offline` when the device is known and not online; nothing is ever queued for it (A3). */
export async function deviceOnline(remote: RemoteThreadSurface, device: string): Promise<Failure | undefined> {
  const devices = await remote.sessions.devices()
  const row = devices.find((candidate) => candidate.device === device)
  if (row === undefined) return fail("not_found", `No device named ${device} is signed in to this account.`, "Call thread_list with all_scope to see the account's devices and threads.", { device })
  if (!row.online) return fail("device_offline", `Device ${device} is offline.`, "Retry when that device is online; nothing was queued.", { device })
  return undefined
}

function openedId(response: JsonObject): string | undefined {
  const state = response["state"]
  const fromState = typeof state === "object" && state !== null ? (Reflect.get(state, "durableSessionId") ?? Reflect.get(state, "sessionId")) : undefined
  if (typeof fromState === "string" && fromState.length > 0) return fromState
  const id = response["sessionId"]
  return typeof id === "string" && id.length > 0 ? id : undefined
}

export type RemoteOpen =
  | { readonly kind: "create"; readonly device: string; readonly cwd?: string; readonly name?: string }
  | { readonly kind: "open"; readonly row: RemoteSessionRow }
  | { readonly kind: "fork"; readonly row: RemoteSessionRow; readonly cwd?: string; readonly name?: string }

/** create / open / fork on another device: one `open_session` on its engine endpoint (#393's attach-less shape). */
export async function openRemote(remote: RemoteThreadSurface, request: RemoteOpen): Promise<ThreadToolResult> {
  const device = request.kind === "create" ? request.device : request.row.device
  const offline = await deviceOnline(remote, device)
  if (offline !== undefined) return offline
  const record: JsonObject = request.kind === "create"
    ? { type: "open_session", retain_on_disconnect: true, ...(request.cwd === undefined ? {} : { cwd: request.cwd }) }
    : request.kind === "open"
      ? { type: "open_session", retain_on_disconnect: true, sessionPath: request.row.path }
      : { type: "open_session", retain_on_disconnect: true, forkFrom: request.row.session_id, ...(request.cwd === undefined ? {} : { cwd: request.cwd }) }
  const outcome = await remote.sessions.endpointCommand(device, record)
  if (outcome.kind !== "ok") return outcomeFailure(outcome, device)
  const threadId = request.kind === "open" ? request.row.session_id : openedId(outcome.response)
  if (threadId === undefined) return fail("internal_error", `Device ${device} opened a session but did not name it.`, "Call thread_list with all_scope to find the new thread.", { device })
  const name = request.kind === "open" ? undefined : request.name
  if (name !== undefined) {
    const named = await remote.sessions.sessionCommand(device, threadId, { type: "set_session_name", sessionId: threadId, name })
    if (named.kind !== "ok") return outcomeFailure(named, device)
  }
  const title = request.kind === "open" ? request.row.title : (name ?? "")
  const now = new Date().toISOString()
  return {
    kind: "ok",
    thread: { thread_id: threadId, name: title, status: "live", cwd: request.kind === "open" ? request.row.project : (request.cwd ?? ""), created_at: now, updated_at: now, device, link: threadLink(threadId, title) },
    deduplicated: false,
  }
}

/** thread_send / thread_handoff to another device's session: one `prompt`, carrying the chain's count (K8, R8.c). */
export async function promptRemote(remote: RemoteThreadSurface, row: RemoteSessionRow, message: string, hop: number): Promise<ThreadToolResult> {
  const offline = await deviceOnline(remote, row.device)
  if (offline !== undefined) return offline
  const state = await remote.sessions.sessionCommand(row.device, row.session_id, { type: "get_state", sessionId: row.session_id })
  if (state.kind !== "ok") return outcomeFailure(state, row.device)
  const streaming = state.response["isStreaming"] === true
  const record = remote.chain.stamp({ type: "prompt", sessionId: row.session_id, message, ...(streaming ? { streamingBehavior: "followUp" } : {}) }, hop)
  const sent = await remote.sessions.sessionCommand(row.device, row.session_id, record)
  if (sent.kind !== "ok") return outcomeFailure(sent, row.device)
  const turnId = typeof sent.response["turnId"] === "string" ? sent.response["turnId"] : ""
  return {
    kind: "ok",
    thread_id: row.session_id,
    link: threadLink(row.session_id, row.title),
    delivery: streaming ? { kind: "queued", queue_position: 1 } : { kind: "started", turn_id: turnId },
    message_seq: 0,
    deduplicated: false,
    device: row.device,
  }
}

export async function interruptRemote(remote: RemoteThreadSurface, row: RemoteSessionRow, turnId: string | undefined): Promise<ThreadToolResult> {
  const offline = await deviceOnline(remote, row.device)
  if (offline !== undefined) return offline
  const outcome = await remote.sessions.sessionCommand(row.device, row.session_id, { type: "abort", sessionId: row.session_id })
  if (outcome.kind !== "ok") return outcomeFailure(outcome, row.device)
  return { kind: "ok", thread_id: row.session_id, ...(turnId === undefined ? {} : { turn_id: turnId }), interrupted: true }
}

export async function readRemote(remote: RemoteThreadSurface, row: RemoteSessionRow): Promise<ThreadToolResult> {
  const offline = await deviceOnline(remote, row.device)
  if (offline !== undefined) return offline
  const outcome = await remote.sessions.read(row.device, row.session_id, 200)
  if (outcome.kind !== "ok") return outcomeFailure(outcome, row.device)
  const entries = Array.isArray(outcome.response["entries"]) ? outcome.response["entries"] : []
  const items = entries.flatMap((entry, seq) => {
    if (typeof entry !== "object" || entry === null) return []
    const role = Reflect.get(entry, "role")
    const content = Reflect.get(entry, "content")
    return typeof content === "string" ? [{ seq, role: transcriptRole(role), content }] : []
  })
  return { kind: "ok", thread_id: row.session_id, link: threadLink(row.session_id, row.title), items, truncated: false, source: "live_host", device: row.device }
}
