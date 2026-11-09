import type { ThreadToolResult } from "../contracts"
import { threadToolFailure, type ThreadToolFailure } from "../errors"
import { REFUSAL_CODES } from "../gateway/result"
import { INITIAL_SKILLS_CONTEXT_KEY } from "../initial-skills"
import { threadLink } from "../thread-link"
import type { ThreadReadInput } from "../contracts"
import type { ThreadTranscriptEntry } from "../reader"
import { liveReadResult } from "../tools/read-ops"
import { outcomeFailure, READ_UNCERTAIN } from "./outcome"
import type { AliasError, AliasHolder, JsonObject, RemoteSessionRow, RemoteThreadSurface } from "./ports"

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

export function aliasFailure(error: AliasError): Failure {
  if (error.code === "alias_taken") return fail("alias_taken", error.message, "Choose another alias; the holder is named in details.", error.details?.holder === undefined ? undefined : { holder: error.details.holder })
  if (error.code === "alias_invalid") return fail("invalid_arguments", error.message, "Use 1-64 visible characters that do not look like a session id.", { reason: error.details?.reason })
  if (error.code === "alias_not_found") return fail("not_found", error.message, "Call thread_list to see the threads and their aliases.")
  return fail("host_unavailable", error.message, "Retry when the account service is reachable.", { reason: error.details?.reason })
}

/**
 * Where a session address points once the account is consulted (A3): another device's session, or this device. With
 * no id or alias match, `none` hands back the account list it read, so step 3 matches titles without a second read.
 */
export type RemoteTarget =
  | { readonly where: "remote"; readonly row: RemoteSessionRow }
  | { readonly where: "here"; readonly session_id: string }
  | { readonly where: "none"; readonly rows: readonly RemoteSessionRow[]; readonly here: string | null }

/**
 * Resolution steps 1b and 2 of the frozen order: an exact session id in the account list, then an alias.
 * Step 1a (this device's exact id) and step 3 (the local name ladder) stay with the local resolver.
 */
export async function locateAcross(remote: RemoteThreadSurface, address: string): Promise<RemoteTarget | Failure> {
  const here = await remote.sessions.thisDevice()
  const rows = await remote.sessions.sessions()
  const byId = rows.find((row) => row.session_id === address)
  if (byId !== undefined) return byId.device === here ? { where: "here", session_id: byId.session_id } : { where: "remote", row: byId }
  if (remote.aliases === undefined) return { where: "none", rows, here }
  // The address was not asked for as an alias, so a registry that cannot answer only means no alias match: a name keeps
  // resolving through step 3 exactly as without a registry. Explicit alias claims keep their typed refusal (planCreate).
  const alias = await remote.aliases.resolve(address).catch(() => undefined)
  if (alias === undefined || alias.kind === "error") return { where: "none", rows, here }
  return holderTarget(remote, alias.value, here, rows)
}

/**
 * The listing row an alias holder names. A thread claimed on its own device is held by its durable id, while the account
 * listing keys every session (terminal-held or rpc-host alike) by the relay key that device's connector assigned and names
 * only its project, so the row cannot be matched by durable id: the holding device maps it (session.locate, the same
 * lookup a create on another device uses). An offline holder device is device_offline; one that is online but cannot map
 * the holder to a session it lists is not_found.
 */
async function holderTarget(remote: RemoteThreadSurface, holder: AliasHolder, here: string | null, rows: readonly RemoteSessionRow[]): Promise<RemoteTarget | Failure> {
  if (holder.device === here) return { where: "here", session_id: holder.session_id }
  const listed = rows.find((row) => row.device === holder.device && row.session_id === holder.session_id)
  if (listed !== undefined) return { where: "remote", row: listed }
  const device = (await remote.sessions.devices()).find((candidate) => candidate.device === holder.device)
  if (device !== undefined && !device.online) return fail("device_offline", `Device ${holder.device} holding this thread is offline.`, "Retry when that device is online; nothing was queued.", { device: holder.device, thread_id: holder.session_id })
  const located = await remote.sessions.locate(holder.device, holder.session_id)
  const row = located.kind === "ok" ? rows.find((candidate) => candidate.device === holder.device && candidate.session_id === located.sessionId) : undefined
  if (row !== undefined) return { where: "remote", row }
  return fail("not_found", `The alias names thread ${holder.session_id} on device ${holder.device}, which that device does not list.`, "Call thread_list with all_scope to find the live thread, then claim the alias for it again with thread_rename.", { device: holder.device, thread_id: holder.session_id, ...(located.kind === "refused" ? { reason: located.reason } : {}) })
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
  // A created or forked session names its creator's mode, so remote work never falls to the engine's delegated default.
  const mode = request.kind === "open" ? undefined : remote.permissionPreset?.()
  const opened: JsonObject = request.kind === "create"
    ? { type: "open_session", retain_on_disconnect: true, ...(request.cwd === undefined ? {} : { cwd: request.cwd }) }
    : request.kind === "open"
      ? { type: "open_session", retain_on_disconnect: true, sessionPath: request.row.path }
      : { type: "open_session", retain_on_disconnect: true, forkFrom: request.row.session_id, ...(request.cwd === undefined ? {} : { cwd: request.cwd }) }
  // A create or fork asks for its new session's listing key on the reply (decision 0018 amendment 2026-11-06).
  const outcome = await remote.sessions.endpointCommand(device, { ...opened, ...skills, ...(mode === undefined ? {} : { permissionPreset: mode }) }, request.kind === "open" ? undefined : { locate: true })
  if (outcome.kind !== "ok") return outcomeFailure(outcome, device)
  // An opened row is already addressed by its listing id; a created or forked session is located by its engine id.
  let threadId: string
  if (request.kind === "open") threadId = request.row.session_id
  else {
    const engineId = openedEngineId(outcome.response)
    if (engineId === undefined) return fail("internal_error", `Device ${device} opened a session but did not name it.`, "Call thread_list with all_scope to find the new thread.", { device })
    // A host that names the session's listing key on the reply (`located`) spares the locate; an older one does not.
    const located = await remote.sessions.locate(device, engineId, outcome.located)
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
 * A person's own input sent to another device's session (`omo remote send`): one `prompt`, exactly as they would type it
 * there, so slash commands and prompt templates are theirs. A peer session never takes this path; its message is a
 * delivery (`relay-transport.ts`). Every result field comes from the remote engine: the turn it started, or its own
 * pending-message count.
 */
export type RemoteSendRequest = { readonly message: string; readonly delivery?: "auto" | "steer" | "follow_up"; readonly expected_turn_id?: string }

export function sendArgumentFailure(request: RemoteSendRequest): Failure | undefined {
  if (request.expected_turn_id !== undefined && !/^\d+$/.test(request.expected_turn_id)) return fail("turn_conflict", `Turn ${request.expected_turn_id} is not a turn of the target session.`, "Read the target again and steer with the turn_id a started or steered result returned.")
  if (request.delivery === "steer" && request.expected_turn_id === undefined) return fail("invalid_arguments", "A steer needs expected_turn_id (the target's current turn_epoch).", "Fix the arguments and send again.")
  return undefined
}

export async function promptRemote(remote: RemoteThreadSurface, row: RemoteSessionRow, request: RemoteSendRequest): Promise<ThreadToolResult> {
  const refused = sendArgumentFailure(request)
  if (refused !== undefined) return refused
  const offline = await deviceOnline(remote, row.device)
  if (offline !== undefined) return offline
  const text = () => ({ message: request.message })
  if (request.delivery === "steer") {
    const state = await remote.sessions.sessionCommand(row.device, row.session_id, { type: "get_state", sessionId: row.session_id })
    if (state.kind !== "ok") return outcomeFailure(state, row.device)
    const engineState = replyData(state.response)
    // gateway/decision.ts: a steer needs a running turn; a compacting session or one waiting on a question is not one.
    const pendingQuestions = engineState["pendingQuestions"]
    const midTurn = engineState["isStreaming"] === true && engineState["isCompacting"] !== true && !(Array.isArray(pendingQuestions) && pendingQuestions.length > 0)
    if (!midTurn) return fail(REFUSAL_CODES.not_steerable.code, `A steer to ${row.session_id} was refused: not_steerable.`, REFUSAL_CODES.not_steerable.next, { device: row.device })
    // An engine that reports no running turn id (before senpi 2026.11.2) cannot have the caller's expected_turn_id checked.
    const current = engineState["currentTurnId"]
    if (typeof current !== "string" || current.length === 0) return fail(REFUSAL_CODES.turn_conflict.code, `Turn ${request.expected_turn_id} of ${row.session_id} cannot be confirmed on device ${row.device}.`, REFUSAL_CODES.turn_conflict.next, { device: row.device, reason: "remote_turn_not_verifiable" })
    if (current !== request.expected_turn_id) return fail(REFUSAL_CODES.turn_conflict.code, `Turn ${request.expected_turn_id} is not the running turn of ${row.session_id} on device ${row.device}.`, REFUSAL_CODES.turn_conflict.next, { device: row.device, current_turn_id: current })
    // The engine checks expectedTurnId again when the steer arrives, so a turn that ended in between is refused there.
    const steer = remote.chain.stamp({ type: "prompt", sessionId: row.session_id, ...text(), streamingBehavior: "steer", expectedTurnId: current }, 1)
    const steered = await remote.sessions.sessionCommand(row.device, row.session_id, steer)
    if (steered.kind === "refused" && (steered.reason === "turn_conflict" || steered.reason === "not_steerable")) return fail(REFUSAL_CODES[steered.reason].code, `A steer to ${row.session_id} was refused: ${steered.reason}.`, REFUSAL_CODES[steered.reason].next, { device: row.device })
    if (steered.kind !== "ok") return outcomeFailure(steered, row.device)
    return { kind: "ok", thread_id: row.session_id, link: threadLink(row.session_id, row.title), delivery: { kind: "steered", turn_id: current }, deduplicated: false, device: row.device }
  }
  // One round trip (#12320): no get_state goes first. The engine itself starts a followUp prompt on an idle session and
  // queues it behind a running turn, deciding both in one step (senpi agent-session `_prompt`, 2026.11.2-3 and later),
  // and its reply's disposition says which happened.
  const record = remote.chain.stamp({ type: "prompt", sessionId: row.session_id, ...text(), streamingBehavior: "followUp" }, 1)
  const sent = await remote.sessions.sessionCommand(row.device, row.session_id, record)
  if (sent.kind !== "ok") return outcomeFailure(sent, row.device)
  const reply = replyData(sent.response)
  const turnId = reply["turnId"]
  if (reply["disposition"] === "started" && typeof turnId === "string" && turnId.length > 0) return { kind: "ok", thread_id: row.session_id, link: threadLink(row.session_id, row.title), delivery: { kind: "started", turn_id: turnId }, deduplicated: false, device: row.device }
  const after = await remote.sessions.sessionCommand(row.device, row.session_id, { type: "get_state", sessionId: row.session_id })
  const settled = after.kind === "ok" ? replyData(after.response) : {}
  // An engine whose prompt reply names no turn (senpi through 2026.11.5-1) reports the running turn in get_state.
  const current = settled["currentTurnId"]
  if (reply["disposition"] === "started" && typeof current === "string" && current.length > 0) return { kind: "ok", thread_id: row.session_id, link: threadLink(row.session_id, row.title), delivery: { kind: "started", turn_id: current }, deduplicated: false, device: row.device }
  const pending = settled["pendingMessageCount"]
  if (typeof pending !== "number" || !Number.isInteger(pending) || pending < 1) return fail("idempotency_uncertain", `Device ${row.device} accepted the message but did not report where it waits.`, "Read the thread before deciding whether to send again.", { device: row.device })
  return { kind: "ok", thread_id: row.session_id, link: threadLink(row.session_id, row.title), delivery: { kind: "queued", queue_position: pending }, deduplicated: false, device: row.device }
}

/** The turn running in another device's session (`get_state.currentTurnId`), for a caller that steers whatever runs. */
export async function runningTurnRemote(remote: RemoteThreadSurface, row: RemoteSessionRow): Promise<{ readonly kind: "ok"; readonly turn_id?: string } | Failure> {
  const offline = await deviceOnline(remote, row.device)
  if (offline !== undefined) return offline
  const state = await remote.sessions.sessionCommand(row.device, row.session_id, { type: "get_state", sessionId: row.session_id })
  if (state.kind !== "ok") return outcomeFailure(state, row.device)
  const current = nonEmpty(replyData(state.response)["currentTurnId"])
  return current === undefined ? { kind: "ok" } : { kind: "ok", turn_id: current }
}

export type RemoteFollow = {
  /** "settled" once the session's run settles (`agent_settled`), "session_closed" when its close cut the run short, else the reason its attach ended first. */
  readonly settled: Promise<string>
  readonly stop: () => void
}

const isRecord = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * Follows another device's session from now on: each assistant text delta (`message_update` / `text_delta`) goes to
 * `onText` in the order the session wrote it, until its run settles, with a line break between the text of separate
 * messages or content blocks. Start it before the send it follows.
 */
export async function followRemote(remote: RemoteThreadSurface, row: RemoteSessionRow, onText: (text: string) => void): Promise<RemoteFollow | Failure> {
  const offline = await deviceOnline(remote, row.device)
  if (offline !== undefined) return offline
  let settle!: (end: string) => void
  const settled = new Promise<string>((resolve) => { settle = resolve })
  let last: { readonly index: unknown; readonly endsLine: boolean } | undefined
  let newMessage = false
  const watched = await remote.sessions.watch(row.device, row.session_id, (record) => {
    // senpi settles a turn the session's close cut short with reason session_closed: that turn never finished.
    if (record["type"] === "agent_settled") return settle(record["reason"] === "session_closed" ? "session_closed" : "settled")
    if (record["type"] === "message_start" || record["type"] === "message_end") newMessage = true
    const event = record["assistantMessageEvent"]
    if (record["type"] !== "message_update" || !isRecord(event) || event["type"] !== "text_delta" || typeof event["delta"] !== "string" || event["delta"] === "") return
    const delta = event["delta"]
    if (last !== undefined && !last.endsLine && (newMessage || event["contentIndex"] !== last.index)) onText("\n")
    newMessage = false
    last = { index: event["contentIndex"], endsLine: delta.endsWith("\n") }
    onText(delta)
  })
  if (watched.kind !== "ok") return outcomeFailure(watched, row.device)
  void watched.watch.ended.then(settle)
  return { settled, stop: watched.watch.stop }
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
