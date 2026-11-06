import type { ThreadToolResult } from "../contracts"
import { threadToolFailure, type ThreadToolFailure } from "../errors"
import { REFUSAL_CODES } from "../gateway/result"
import { INITIAL_SKILLS_CONTEXT_KEY } from "../initial-skills"
import { threadLink } from "../thread-link"
import type { ThreadReadInput } from "../contracts"
import type { ThreadTranscriptEntry } from "../reader"
import { liveReadResult } from "../tools/read-ops"
import type { CommandResult } from "@oh-my-opencode/device-service-core"
import type { AliasError, AliasHolder, JsonObject, RemoteCommandOutcome, RemoteSessionRow, RemoteThreadSurface } from "./ports"

type Failure = { readonly kind: "error"; readonly error: ThreadToolFailure }
const fail = (code: ThreadToolFailure["code"], message: string, next: string, details?: Readonly<Record<string, unknown>>): Failure => ({ kind: "error", error: threadToolFailure(code, message, next, details) })

/** A5: the relay is paid only; on any other plan the remote path answers this, never a silent failure or a queue. */
export async function remoteAvailable(remote: RemoteThreadSurface): Promise<Failure | undefined> {
  let state: string
  try {
    state = (await remote.sessions.status()).state
  } catch (error) {
    return fail("host_unavailable", "This device's device service is not reachable.", "Install or start the device service, then retry.", { reason: error instanceof Error ? error.message : String(error) })
  }
  if (state === "plan_required") return fail("relay_requires_paid_plan", "Reaching sessions on other devices needs a paid plan; this account's plan has no relay.", "Upgrade the plan to use other devices, or work with threads on this device.")
  if (state !== "connected") return fail("host_unavailable", `Other devices are not reachable from this device right now (${state}).`, "Sign in, turn remote sessions on, or wait for the device service to connect, then retry.", { state })
  return undefined
}

type UncertainReason = Extract<CommandResult["outcome"], { readonly state: "uncertain" }>["reason"]

// How each reason a read-only record can end uncertain with is answered once device-service.ts has refused it (nothing
// can have changed). Typed over the device service's whole uncertain vocabulary, so a new reason fails the typecheck
// here instead of falling through to "update omo".
const READ_UNCERTAIN: Readonly<Record<UncertainReason, "retry" | "too_large">> = {
  request_gone: "retry", no_receipt: "retry", engine_restarted: "retry", recipient_revoked: "retry", transport_expired: "retry",
  unconfirmed: "retry", lease_expired: "retry", cancelled: "retry", hand_restarted: "retry", result_expired: "retry", record_too_large: "too_large",
}

// Refusals after which this call changed nothing on the other device: a command that never reached its engine (a lost
// connection, a failed attach) or a read-only record that failed either way. Retrying is safe, and nothing about that
// device needs updating.
const UNANSWERED: ReadonlySet<string> = new Set([
  "closed", "protocol_violation", "internal", "read_failed", "request_timeout", "handshake_timeout", "attach_failed", "reply_lost",
  "host_not_answering", "peer_not_found", "engine_stale",
  ...Object.entries(READ_UNCERTAIN).filter(([, answer]) => answer === "retry").map(([reason]) => reason),
])

export function outcomeFailure(outcome: Exclude<RemoteCommandOutcome, { readonly kind: "ok" }>, device: string): Failure {
  if (outcome.kind === "uncertain") return fail("idempotency_uncertain", `The command to device ${device} may or may not have run (${outcome.reason}).`, "Read the thread before deciding whether to retry.", { device, reason: outcome.reason })
  if (outcome.reason === "capability_missing") return fail("scope_denied", `Device ${device} does not grant this command.`, "Allow commands from this device on the other device, then retry.", { device, reason: outcome.reason })
  if (outcome.reason === "host_detached") return fail("host_unavailable", `Device ${device} is not attached to the relay.`, "Retry when that device is signed in and online.", { device, reason: outcome.reason })
  if (UNANSWERED.has(outcome.reason)) return fail("host_unavailable", `Device ${device} did not answer (${outcome.reason}); this call changed nothing there.`, "Retry; nothing needs to be checked first.", { device, reason: outcome.reason })
  if (outcome.reason === "record_too_large") return fail("unsupported", `The thread on device ${device} is too large to send back in one relay record (record_too_large).`, "Read it on that device, or ask that thread for a summary with thread_send.", { device, reason: outcome.reason })
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
  if (remote.aliases === undefined) return { where: "none" }
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

/**
 * The engine's reply payload. The device service hands back senpi's whole response envelope
 * (`{type: "response", command, success, data}`), and every field a tool reads lives under `data`.
 */
export function replyData(response: JsonObject): JsonObject {
  const data = response["data"]
  return typeof data === "object" && data !== null && !Array.isArray(data) ? data as JsonObject : {}
}

const nonEmpty = (value: unknown): string | undefined => (typeof value === "string" && value.length > 0 ? value : undefined)

// The engine session id the open_session reply names: its durable session id, else the relay session id. It is in no
// listing row, so it is never the thread id itself; session.locate maps it to the key the device lists it by.
function openedEngineId(response: JsonObject): string | undefined {
  const data = replyData(response)
  const state = data["state"]
  const fromState = typeof state === "object" && state !== null && !Array.isArray(state) ? (state as JsonObject) : {}
  return nonEmpty(fromState["durableSessionId"]) ?? nonEmpty(data["durableSessionId"]) ?? nonEmpty(fromState["sessionId"]) ?? nonEmpty(data["sessionId"])
}

export type RemoteOpen =
  | { readonly kind: "create"; readonly device: string; readonly cwd?: string; readonly name?: string; readonly skills?: readonly string[] }
  | { readonly kind: "open"; readonly row: RemoteSessionRow }
  | { readonly kind: "fork"; readonly row: RemoteSessionRow; readonly cwd?: string; readonly name?: string; readonly skills?: readonly string[] }

/** create / open / fork on another device: one `open_session` on its engine endpoint (#393's attach-less shape). */
export async function openRemote(remote: RemoteThreadSurface, request: RemoteOpen): Promise<ThreadToolResult> {
  const device = request.kind === "create" ? request.device : request.row.device
  const offline = await deviceOnline(remote, device)
  if (offline !== undefined) return offline
  const skills = request.kind === "open" || request.skills === undefined || request.skills.length === 0 ? {} : { context: { [INITIAL_SKILLS_CONTEXT_KEY]: JSON.stringify(request.skills) } }
  const opened: JsonObject = request.kind === "create"
    ? { type: "open_session", retain_on_disconnect: true, ...(request.cwd === undefined ? {} : { cwd: request.cwd }) }
    : request.kind === "open"
      ? { type: "open_session", retain_on_disconnect: true, sessionPath: request.row.path }
      : { type: "open_session", retain_on_disconnect: true, forkFrom: request.row.session_id, ...(request.cwd === undefined ? {} : { cwd: request.cwd }) }
  const outcome = await remote.sessions.endpointCommand(device, { ...opened, ...skills })
  if (outcome.kind !== "ok") return outcomeFailure(outcome, device)
  // An opened row is already addressed by its listing id; a created or forked session is located by its engine id.
  let threadId: string
  if (request.kind === "open") threadId = request.row.session_id
  else {
    const engineId = openedEngineId(outcome.response)
    if (engineId === undefined) return fail("internal_error", `Device ${device} opened a session but did not name it.`, "Call thread_list with all_scope to find the new thread.", { device })
    const located = await remote.sessions.locate(device, engineId)
    if (located.kind !== "ok") return fail("unsupported", `Device ${device} created a session but its id there could not be found (${located.reason}).`, "Call thread_list with all_scope to find the new thread, or update omo on that device.", { device, reason: located.reason })
    threadId = located.sessionId
  }
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

/**
 * thread_send / thread_handoff to another device's session: one `prompt`, carrying the chain's count (K8, R8.c).
 * Every result field comes from the remote engine: the turn it started, or its own pending-message count.
 */
export type RemoteSendRequest = { readonly message: string; readonly delivery?: "auto" | "steer" | "follow_up"; readonly expected_turn_id?: string }

/**
 * The send-time refusals a local send makes (tools.ts deliverThroughGateway, then gateway/engine.ts deliver), in the
 * same order and words; the unknown-caller refusal comes first, in tools.ts, before any receipt is written. The engine's
 * 1 MiB message_too_large cannot be reached by either leg: the shared param schema caps a message at
 * THREAD_MESSAGE_MAX_BYTES before any send.
 */
export function sendArgumentFailure(request: RemoteSendRequest): Failure | undefined {
  if (request.expected_turn_id !== undefined && !/^\d+$/.test(request.expected_turn_id)) return fail("turn_conflict", `Turn ${request.expected_turn_id} is not a turn of the target session.`, "Read the target again and steer with the turn_id a started or steered result returned.")
  if (request.delivery === "steer" && request.expected_turn_id === undefined) return fail("invalid_arguments", "A steer needs expected_turn_id (the target's current turn_epoch).", "Fix the arguments and send again.")
  return undefined
}

export async function promptRemote(remote: RemoteThreadSurface, row: RemoteSessionRow, request: RemoteSendRequest, hop: number): Promise<ThreadToolResult> {
  const refused = sendArgumentFailure(request)
  if (refused !== undefined) return refused
  const offline = await deviceOnline(remote, row.device)
  if (offline !== undefined) return offline
  const state = await remote.sessions.sessionCommand(row.device, row.session_id, { type: "get_state", sessionId: row.session_id })
  if (state.kind !== "ok") return outcomeFailure(state, row.device)
  const engineState = replyData(state.response)
  const streaming = engineState["isStreaming"] === true
  if (request.delivery === "steer") {
    // gateway/decision.ts: a steer needs a running turn; a compacting session or one waiting on a question is not one.
    const pendingQuestions = engineState["pendingQuestions"]
    const midTurn = streaming && engineState["isCompacting"] !== true && !(Array.isArray(pendingQuestions) && pendingQuestions.length > 0)
    if (!midTurn) return fail(REFUSAL_CODES.not_steerable.code, `A steer to ${row.session_id} was refused: not_steerable.`, REFUSAL_CODES.not_steerable.next, { device: row.device })
    // The other device's engine reports no turn id, so the caller's expected_turn_id cannot be checked there yet.
    return fail(REFUSAL_CODES.turn_conflict.code, `Turn ${request.expected_turn_id} of ${row.session_id} cannot be confirmed on device ${row.device}.`, REFUSAL_CODES.turn_conflict.next, { device: row.device, reason: "remote_turn_not_verifiable" })
  }
  const message = request.message
  const record = remote.chain.stamp({ type: "prompt", sessionId: row.session_id, message, ...(streaming ? { streamingBehavior: "followUp" } : {}) }, hop)
  const sent = await remote.sessions.sessionCommand(row.device, row.session_id, record)
  if (sent.kind !== "ok") return outcomeFailure(sent, row.device)
  const reply = replyData(sent.response)
  const turnId = reply["turnId"]
  if (reply["disposition"] === "started" && typeof turnId === "string" && turnId.length > 0) return { kind: "ok", thread_id: row.session_id, link: threadLink(row.session_id, row.title), delivery: { kind: "started", turn_id: turnId }, deduplicated: false, device: row.device }
  const after = await remote.sessions.sessionCommand(row.device, row.session_id, { type: "get_state", sessionId: row.session_id })
  const settled = after.kind === "ok" ? replyData(after.response) : {}
  // An engine that predates turnId in the prompt reply (senpi 2026.11.2) still reports the running turn in get_state.
  const current = settled["currentTurnId"]
  if (reply["disposition"] === "started" && typeof current === "string" && current.length > 0) return { kind: "ok", thread_id: row.session_id, link: threadLink(row.session_id, row.title), delivery: { kind: "started", turn_id: current }, deduplicated: false, device: row.device }
  const pending = settled["pendingMessageCount"]
  if (typeof pending !== "number" || !Number.isInteger(pending) || pending < 1) return fail("idempotency_uncertain", `Device ${row.device} accepted the message but did not report where it waits.`, "Read the thread before deciding whether to send again.", { device: row.device })
  return { kind: "ok", thread_id: row.session_id, link: threadLink(row.session_id, row.title), delivery: { kind: "queued", queue_position: pending }, deduplicated: false, device: row.device }
}

/** The local engine's own `interrupt` record, so an idle session answers interrupted:false exactly as on this device. */
export async function interruptRemote(remote: RemoteThreadSurface, row: RemoteSessionRow, turnId: string | undefined): Promise<ThreadToolResult> {
  const offline = await deviceOnline(remote, row.device)
  if (offline !== undefined) return offline
  const outcome = await remote.sessions.sessionCommand(row.device, row.session_id, { type: "interrupt", sessionId: row.session_id, ...(turnId === undefined ? {} : { turnId }) })
  if (outcome.kind !== "ok") return outcomeFailure(outcome, row.device)
  const reply = replyData(outcome.response)
  const reported = reply["turnId"]
  return { kind: "ok", thread_id: row.session_id, ...(typeof reported === "string" ? { turn_id: reported } : {}), interrupted: reply["interrupted"] === true }
}

// The refusals that mean the session was no longer on the other device's engine when the command reached it.
const SESSION_GONE: ReadonlySet<string> = new Set(["session_not_found", "unknown_session", "session_identity_mismatch"])

/**
 * The other device's engine ends the session for every client that holds it, as a local close does: an attached
 * `unload_session` with force (a `close_session` would release only this device's own hold). A session with no file
 * yet cannot be unloaded, so it gets an attached `close_session` and a `get_state` that proves it ended. A session
 * that is not live there answers `closed: false`.
 */
export async function closeRemote(remote: RemoteThreadSurface, row: RemoteSessionRow): Promise<ThreadToolResult> {
  const offline = await deviceOnline(remote, row.device)
  if (offline !== undefined) return offline
  const closed = (value: boolean): ThreadToolResult => ({ kind: "ok", thread_id: row.session_id, closed: value, device: row.device })
  if (row.state === "ended") return closed(false)
  const unload = await remote.sessions.sessionCommand(row.device, row.session_id, { type: "unload_session", sessionId: row.session_id, force: true, interrupt: true, children: "detach" })
  if (unload.kind === "refused" && SESSION_GONE.has(unload.reason)) return closed(false)
  if (unload.kind !== "ok") return outcomeFailure(unload, row.device)
  const unloaded = replyData(unload.response)
  const reason = unloaded["reason"]
  if (unloaded["outcome"] === "unloaded") return closed(true)
  if (reason === "session_closing") return closed(false)
  if (reason !== "unsupported") return fail("unsupported", `Device ${row.device} refused to close ${row.session_id} (${String(reason)}).`, "Read the thread on that device and retry once its work settles.", { device: row.device, reason, detail: unloaded["detail"] })
  const close = await remote.sessions.sessionCommand(row.device, row.session_id, { type: "close_session", sessionId: row.session_id })
  if (close.kind === "refused" && SESSION_GONE.has(close.reason)) return closed(false)
  if (close.kind !== "ok") return outcomeFailure(close, row.device)
  const after = await remote.sessions.sessionCommand(row.device, row.session_id, { type: "get_state", sessionId: row.session_id })
  if (after.kind === "ok") return fail("foreign_live_owner", `Thread ${row.session_id} on device ${row.device} has no session file yet and another client still holds it, so only this device's hold was released.`, "Close it from the client that holds it, or send it a message first so it can be closed for every holder.", { device: row.device })
  if (SESSION_GONE.has(after.reason) || after.reason === "not_attached") return closed(true)
  return fail("idempotency_uncertain", `Device ${row.device} accepted the close of ${row.session_id} but did not confirm the session ended (${after.reason}).`, "Call thread_list with all_scope to see whether it is still live.", { device: row.device, reason: after.reason })
}

/** The local engine's `get_messages`, read through the same bounded reader as a live local thread (cursor, max_bytes, truncated). */
export async function readRemote(remote: RemoteThreadSurface, row: RemoteSessionRow, window: ThreadReadInput): Promise<ThreadToolResult> {
  const offline = await deviceOnline(remote, row.device)
  if (offline !== undefined) return offline
  const outcome = await remote.sessions.sessionCommand(row.device, row.session_id, { type: "get_messages", sessionId: row.session_id })
  if (outcome.kind !== "ok") return outcomeFailure(outcome, row.device)
  const listed = replyData(outcome.response)["messages"]
  const messages = Array.isArray(listed) ? listed as ThreadTranscriptEntry[] : []
  const result = liveReadResult(row.session_id, row.title, messages, window)
  return result.kind === "ok" ? { ...result, device: row.device } as ThreadToolResult : result
}
