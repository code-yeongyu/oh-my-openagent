import type { AgentToolResult, ToolDefinition } from "@code-yeongyu/senpi"
import { randomUUID } from "node:crypto"
import { type Static } from "typebox"
import { toThreadAddressEntries } from "./address-book"
import { checkNameConflict, fuzzyMatch, normalizeThreadName, workspaceEntries, type ThreadAddressEntry } from "./addressing"
import { checkInitialSkills } from "./initial-skills"
import {
  parseThreadParams,
  threadToolParamSchemas,
  type ThreadCloseInput,
  type ThreadCreateInput,
  type ThreadHandoffInput,
  type ThreadInterruptInput,
  type ThreadListInput,
  type ThreadReadInput,
  type ThreadRenameInput,
  type ThreadSendInput,
  type ThreadSetModelInput,
  type ThreadSetReasoningInput,
  type ThreadToolName,
  type ThreadToolResult,
} from "./contracts"
import { THREAD_FAMILY_PROMPT_GUIDELINES } from "./metadata"
import { threadLink } from "./thread-link"
export type { ThreadTranscriptEntry } from "./reader"
import { hashArgs } from "./gateway/bindings"
import { GATEWAY_RECEIPT_RETENTION_MS } from "./gateway/constants"
import type { GatewayEngine } from "./gateway/engine"
import { isLockWaitExceeded } from "./gateway/lock-wait"
import { createGatewayServices } from "./tools/gateway-services"
import { listThreads, readThread } from "./tools/read-ops"
import { createRelayTools } from "./tools/relay-tools"
import { localScope } from "./remote/local-scope"
import { closeRemote, crossTarget, deviceOnline, interruptRemote, listAcross, outcomeFailure, planCreate, promptRemote, readRemote, renameAlias, setModelRemote, withAlias } from "./remote/lazy-ops"
import type { RemotePeer } from "./remote/peer-text"
import { matchModel, modelPatternFailure } from "./tools/model-match"
import { recordThreadCreator, registerExtensionTools, type ExtensionToolHost } from "./tools/extension-tools"
export type { ThreadHost, ThreadHostSession, ThreadToolSurfaceOptions } from "./tools/ports"
export { UNKNOWN_CALLER } from "./tools/ports"
import { UNKNOWN_CALLER, type ThreadHost, type ThreadHostView, type ThreadHostViewRequest, type ThreadToolSurfaceOptions } from "./tools/ports"
import {
  degradedSummary,
  failure,
  hostView,
  metadata,
  output,
  resolution,
  resolveEntries,
  routingId,
  sendAddressBook,
  sessionPort,
  summary,
  targetSession,
  type AnyTool,
  type ToolOutput,
} from "./tools/internals"

/** How many keys a tool surface keeps for recovering receipts whose admission reply was lost. */
export const RECEIPT_RECOVERY_MAX_KEYS = 4_096
/** A registered exact id needs no pre-engine view; the engine validates its one endpoint. */
const PUBLISHED_SEND_VIEW: ThreadHostView = { sessions: [], hosts: [], disk: [] }

export function createThreadTools(options: ThreadToolSurfaceOptions): readonly AnyTool[] {
  return buildThreadTools(options).tools
}

function buildThreadTools(options: ThreadToolSurfaceOptions): { readonly tools: readonly AnyTool[]; readonly dispose: () => void } {
  const { store, engine, relay, senderProvenance } = createGatewayServices(options, () => view({ offline: true }))
  const now = options.now ?? store.now
  async function view(request?: ThreadHostViewRequest): Promise<ThreadHostView> { await options.ensureHost?.(); return hostView(options, request) }
  // Receipts this process began but could not settle (the store gave up at its lock-wait bound):
  // the row stays `prepared` under this instance, which would answer `idempotency_in_progress`
  // forever. A retry of such a key is `idempotency_uncertain` with the note instead.
  const unsettled = new Map<string, string>()
  // Keys whose receipt admission failed without a reply: the store may still have committed the
  // prepared row (its worker exited after the commit), which this instance's retry would read as
  // `in_progress` forever. Nothing ran for such a call, so a retry that finds that row while no
  // invocation of this facade is running the key takes it up and runs the call. Each key is kept
  // until the receipt it may have left expires (admission time + the receipt retention), at most
  // `RECEIPT_RECOVERY_MAX_KEYS` at once: when full, a call under a new key is refused before its
  // admission, so no key that may still need recovering is ever dropped. Disposal clears them.
  const unanswered = new Map<string, number>()
  // Keys whose admission is awaiting the store, with how many calls await it: each may become a
  // recovery key, so it holds a slot from before its admission until the store answers (or the
  // failure leaves it in `unanswered`). Overlapping calls under one key share one slot.
  const admitting = new Map<string, number>()
  const heldSlots = (): number => {
    let held = unanswered.size
    for (const key of admitting.keys()) if (!unanswered.has(key)) held++
    return held
  }
  const recoverable = (key: string, at: number): boolean => {
    const until = unanswered.get(key)
    if (until !== undefined && until <= at) unanswered.delete(key)
    return unanswered.has(key)
  }
  const recoveryFull = (at: number): boolean => {
    if (heldSlots() < RECEIPT_RECOVERY_MAX_KEYS) return false
    for (const [key, until] of unanswered) if (until <= at) unanswered.delete(key)
    return heldSlots() >= RECEIPT_RECOVERY_MAX_KEYS
  }
  const releaseAdmitting = (key: string): void => {
    const calls = admitting.get(key) ?? 0
    if (calls <= 1) admitting.delete(key)
    else admitting.set(key, calls - 1)
  }
  const running = new Set<string>()
  const receiptKey = (scope: { readonly principal: string; readonly operation: string; readonly idempotency_key: string }) => `${scope.principal}\u0000${scope.operation}\u0000${scope.idempotency_key}`
  async function execute<T extends ThreadToolName>(name: T, callId: string, args: unknown, ectx: unknown, sideEffect: (view: ThreadHostView, value: Static<(typeof threadToolParamSchemas)[T]>, operationId: string, callerId: string) => Promise<ThreadToolResult>): Promise<ToolOutput> {
    const callerId = (ectx as { sessionManager?: { getSessionId?: () => string } } | undefined)?.sessionManager?.getSessionId?.() ?? options.callerSessionId()
    const parsed = parseThreadParams(threadToolParamSchemas[name], args)
    if (parsed.kind === "error") return output(parsed as ThreadToolResult)
    const value = parsed.value as Static<(typeof threadToolParamSchemas)[T]>
    const explicitKey = "idempotency_key" in value ? (value as { idempotency_key?: string }).idempotency_key?.trim() : undefined
    const scope = { principal: `session:${callerId}`, operation: name, idempotency_key: explicitKey !== undefined && explicitKey.length > 0 ? explicitKey : `call:${callId}` }
    // A send owns its idempotency: the gateway engine's receipt is written in the delivery's own
    // transaction and answers a lost ACK with `idempotency_uncertain` + the row state.
    const receipted = !(name === "thread_send" || name === "thread_handoff")
    if (receipted) {
      // Nothing has run yet, so a store that cannot admit the receipt fails the call as data: the store
      // lock held past its wait bound is `overloaded`, any other store failure `internal_error`.
      const key = receiptKey(scope)
      const at = now()
      // The slot is taken before the admission is awaited, so overlapping calls cannot all pass the check.
      if (!recoverable(key, at) && !admitting.has(key) && recoveryFull(at)) {
        return output(failure("overloaded", `${RECEIPT_RECOVERY_MAX_KEYS} earlier calls on this surface failed before the gateway store answered and may still need recovering; nothing ran.`, "Retry those calls under their own idempotency keys, then retry this one.", { budget: "receipt_recovery", max_keys: RECEIPT_RECOVERY_MAX_KEYS }))
      }
      let admission: Awaited<ReturnType<typeof store.toolReceiptBegin>>
      admitting.set(key, (admitting.get(key) ?? 0) + 1)
      try {
        admission = await store.toolReceiptBegin({ ...scope, now: at, args_hash: hashArgs(value) })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (isLockWaitExceeded(error)) return output(failure("overloaded", `The gateway store is locked by another process; nothing ran: ${message}`, "Wait a few seconds, then retry the call."))
        unanswered.set(key, at + GATEWAY_RECEIPT_RETENTION_MS)
        return output(failure("internal_error", `The gateway store could not record the call; nothing ran: ${message}`, "Retry the call; if it keeps failing, check the gateway store."))
      } finally {
        // The slot passes to the key's recovery entry when the failure left one; otherwise it is free again.
        releaseAdmitting(key)
      }
      if (admission.kind === "in_progress" && recoverable(key, at) && !running.has(key) && !unsettled.has(key)) admission = { kind: "accepted" }
      unanswered.delete(key)
      if (admission.kind === "replay") return output(admission.result as ThreadToolResult)
      if (admission.kind === "conflict") return output(failure("idempotency_conflict", "The idempotency key was already used with different arguments.", "Retry with a new idempotency_key."))
      if (admission.kind === "in_progress") {
        const note = unsettled.get(receiptKey(scope))
        if (note !== undefined) return output(failure("idempotency_uncertain", "The earlier operation may have been delivered.", "Read the target transcript before deciding whether to retry.", { error_note: note }))
        return output(failure("idempotency_in_progress", "The same operation is already in progress.", "Wait for the earlier call to settle, then retry."))
      }
      if (admission.kind === "uncertain") return output(failure("idempotency_uncertain", "The earlier operation may have been delivered.", "Read the target transcript before deciding whether to retry.", admission.error_note === null ? undefined : { error_note: admission.error_note }))
    }
    const unrecorded = (what: string) => (settleError: unknown) => {
      unsettled.set(receiptKey(scope), `${what}, and its receipt could not be recorded: ${settleError instanceof Error ? settleError.message : String(settleError)}`)
    }
    let result: ThreadToolResult
    if (receipted) running.add(receiptKey(scope))
    try {
      // A send takes nothing live as the offline case: its view never raises host_unavailable.
      const current = name === "thread_send" && "thread" in value && typeof value.thread === "string" && value.thread !== "self" && await store.sessionOwner(value.thread) !== null
        ? PUBLISHED_SEND_VIEW
        : await view(receipted ? undefined : { offline: true })
      result = await sideEffect(current, value, scope.idempotency_key, callerId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (receipted) await store.toolReceiptSettle({ ...scope, now: now(), error_note: message }).catch(unrecorded(`the call failed (${message})`))
      running.delete(receiptKey(scope))
      if (message.startsWith("host_unavailable:")) {
        return output(failure("host_unavailable", `The thread host is unavailable at ${message.slice("host_unavailable:".length)}.`, "Retry when the shared Senpi host is running."))
      }
      if (message.startsWith("unsupported:")) {
        return output(failure("unsupported", `The target's endpoint does not accept ${message.slice("unsupported:".length)}: that terminal runs an engine from before terminal session controls.`, "Update omo where that terminal runs and restart it, or use thread_send and thread_read; thread_list shows each thread's controls.", { command: message.slice("unsupported:".length) }))
      }
      return output(failure("internal_error", `Thread operation failed: ${message}`, "Call thread_list and retry after checking the target."))
    }
    if (receipted) await store.toolReceiptSettle({ ...scope, now: now(), result }).catch(unrecorded("the call ran"))
    running.delete(receiptKey(scope))
    return output(result)
  }

  // Fuzzy candidates follow the exact ladder's scope: the caller's workspace unless all_scope.
  const fuzzyCandidates = (entries: ThreadAddressEntry[], allScope: boolean | undefined) => allScope === true ? entries : workspaceEntries(entries, options.callerWorkspaceRoot())
  const create: AnyTool = { ...metadata("thread_create"), parameters: threadToolParamSchemas.thread_create, promptGuidelines: [THREAD_FAMILY_PROMPT_GUIDELINES], execute: (id: string, args: ThreadCreateInput, _signal, _onUpdate, ectx) => execute("thread_create", id, args, ectx, async (current, value, _operationId, callerId) => {
    const entries = resolveEntries(options, current)
    // Every check a local create makes runs before any device is asked, so another device refuses the same way.
    if (value.name !== undefined) { const conflict = checkNameConflict(entries, value.name); if (conflict.kind === "error") return { kind: "error", error: conflict } as ThreadToolResult }
    const skills = value.skills === undefined || value.skills.length === 0 ? undefined : checkInitialSkills(value.skills)
    if (skills?.kind === "invalid") return failure("invalid_arguments", `Not a skill name: ${skills.names.join(", ")}. Pass the names of installed skills, never a path or text.`, "Pass skill names as listed by the skill index.", { invalid: skills.names })
    const loaded = skills?.kind === "ok" ? skills.names : undefined
    const plan = await planCreate(options.remote, { ...value, ...(loaded === undefined ? {} : { skills: loaded }) }, (address) => resolution(options, entries, address, callerId, true))
    if (plan.kind === "done") return plan.result
    if (plan.kind === "open-local") return await withAlias(options.remote, value.alias, await openLocal(current, plan.address, callerId))
    const session = await options.host.openSession({ cwd: value.cwd, forkFrom: plan.forkFrom ?? value.fork_from, name: value.name, ...(loaded === undefined ? {} : { initialSkills: loaded }) })
    return await withAlias(options.remote, value.alias, await recordThreadCreator(options, current, callerId, { kind: "ok", thread: { ...summary(session), ...(loaded === undefined ? {} : { requested_skills: loaded }) }, deduplicated: false }))
  }) }
  const list: AnyTool = {
    ...metadata("thread_list"),
    parameters: threadToolParamSchemas.thread_list,
    execute: (id: string, args: ThreadListInput, _signal, _onUpdate, ectx) => execute("thread_list", id, args, ectx, async (current, value) => await listAcross(options.remote, listThreads(options, current, value.all_scope), value.all_scope === true)),
  }
  const read: AnyTool = { ...metadata("thread_read"), parameters: threadToolParamSchemas.thread_read, execute: (id: string, args: ThreadReadInput, _signal, _onUpdate, ectx) => execute("thread_read", id, args, ectx, async (current, value, _operationId, callerId) => {
    const target = options.remote === undefined ? { kind: "local" as const, address: value.thread } : await crossTarget(options.remote, value.thread, resolution(options, resolveEntries(options, current), value.thread, callerId, true))
    if (target.kind === "error") return target.result
    if (target.kind === "remote" && options.remote !== undefined) return await readRemote(options.remote, target.row, value)
    return readThread(options, current, { ...value, thread: target.kind === "local" ? target.address : value.thread, all_scope: localScope(target, value.all_scope) }, callerId)
  }) }
  const send: AnyTool = { ...metadata("thread_send"), parameters: threadToolParamSchemas.thread_send, execute: (id: string, args: ThreadSendInput, _signal, _onUpdate, ectx) => execute("thread_send", id, args, ectx, async (current, value, operationId, callerId) => deliver(current, value.thread, value, operationId, callerId)) }
  const interrupt: AnyTool = { ...metadata("thread_interrupt"), parameters: threadToolParamSchemas.thread_interrupt, execute: (id: string, args: ThreadInterruptInput, _signal, _onUpdate, ectx) => execute("thread_interrupt", id, args, ectx, async (current, value, _operationId, callerId) => { const target = options.remote === undefined ? { kind: "local" as const, address: value.thread } : await crossTarget(options.remote, value.thread, resolution(options, resolveEntries(options, current), value.thread, callerId, true)); if (target.kind === "error") return target.result; if (target.kind === "remote" && options.remote !== undefined) return await interruptRemote(options.remote, target.row, value.turn_id); const resolved = resolution(options, resolveEntries(options, current), target.kind === "local" ? target.address : value.thread, callerId, localScope(target, value.all_scope)); if (resolved.kind === "error") return { kind: "error", error: resolved } as ThreadToolResult; const session = targetSession(current, resolved.entry.thread_id); if (session === undefined) return failure("not_resumable", "The thread has no live owner.", "Retry when the target is live."); const result = await sessionPort(options, session).interrupt(session.sessionId, value.turn_id, resolved.entry.thread_id); return { kind: "ok", thread_id: resolved.entry.thread_id, ...(result.turnId === undefined ? {} : { turn_id: result.turnId }), interrupted: result.interrupted === true } }) }
  const close: AnyTool = {
    ...metadata("thread_close"),
    parameters: threadToolParamSchemas.thread_close,
    execute: (id: string, args: ThreadCloseInput, _signal, _onUpdate, ectx) => execute("thread_close", id, args, ectx, async (current, value, _operationId, callerId) => {
      const target = options.remote === undefined ? { kind: "local" as const, address: value.thread } : await crossTarget(options.remote, value.thread, resolution(options, resolveEntries(options, current), value.thread, callerId, true))
      if (target.kind === "error") return target.result
      if (target.kind === "remote" && options.remote !== undefined) return await closeRemote(options.remote, target.row)
      const resolved = resolution(options, resolveEntries(options, current), target.kind === "local" ? target.address : value.thread, callerId, localScope(target, value.all_scope))
      if (resolved.kind === "error") return { kind: "error", error: resolved } as ThreadToolResult
      const session = targetSession(current, resolved.entry.thread_id)
      // Nothing live holds it: there is nothing to close, and the thread stays resumable from its session file.
      if (session === undefined) return { kind: "ok", thread_id: resolved.entry.thread_id, closed: false }
      if (session.endpoint_kind === "tui") return failure("unsupported", `Thread ${resolved.entry.thread_id} belongs to an interactive terminal, which closes it when the terminal exits.`, "Close that terminal, or use thread_interrupt to stop its turn.", { command: "close_session" })
      const port = sessionPort(options, session)
      if (port.closeSession === undefined) return failure("unsupported", `The host holding thread ${resolved.entry.thread_id} does not accept close requests.`, "Update omo on this device and restart its host.", { command: "close_session" })
      const outcome = await port.closeSession(routingId(session), resolved.entry.thread_id)
      if (outcome === "held_elsewhere") return failure("foreign_live_owner", `Thread ${resolved.entry.thread_id} has no session file yet and another client still holds it, so only this tool's hold was released.`, "Close it from the client that holds it, or send it a message first so it can be closed for every holder.")
      return { kind: "ok", thread_id: resolved.entry.thread_id, closed: outcome === "closed" }
    }),
  }
  const handoff: AnyTool = { ...metadata("thread_handoff"), parameters: threadToolParamSchemas.thread_handoff, execute: (id: string, args: ThreadHandoffInput, _signal, _onUpdate, ectx) => execute("thread_handoff", id, args, ectx, async (current, value, operationId, callerId) => { if (value.match === "fuzzy" && value.all_scope !== true && options.callerWorkspaceRoot().trim() === "") return failure("caller_context_missing", "Scoping a fuzzy handoff needs the caller's workspace root, which this call did not provide.", "Set all_scope to search every workspace, or hand off from a session that knows its workspace."); if (value.match !== "fuzzy" && options.remote !== undefined && current !== PUBLISHED_SEND_VIEW) { const across = await crossTarget(options.remote, value.thread, resolution(options, toThreadAddressEntries(sendAddressBook(options, current, value.thread, true)), value.thread, callerId, true)); if (across.kind === "error") return across.result; if (across.kind === "remote") return await deliver(current, value.thread, value, operationId, callerId, "exact_name") }; const entries = value.match === "fuzzy" ? fuzzyCandidates(resolveEntries(options, current), value.all_scope) : toThreadAddressEntries(sendAddressBook(options, current, value.thread, value.all_scope)); const resolved = value.match === "fuzzy" ? fuzzyMatch(entries.filter((entry) => entry.thread_id !== callerId), value.thread) : resolution(options, entries, value.thread, callerId, value.all_scope); if (resolved.kind === "error") return { kind: "error", error: resolved } as ThreadToolResult; return deliver(current, resolved.entry.thread_id, value, operationId, callerId, value.match === "fuzzy" ? "fuzzy" : "exact_name") }) }
  const rename: AnyTool = {
    ...metadata("thread_rename"),
    parameters: threadToolParamSchemas.thread_rename,
    execute: (id: string, args: ThreadRenameInput, _signal, _onUpdate, ectx) => execute("thread_rename", id, args, ectx, async (current, value, operationId, callerId) => {
      if (value.name === undefined && value.alias === undefined) return failure("invalid_arguments", "Pass a new name, a new alias, or both.", "Retry with name or alias.")
      const entries = resolveEntries(options, current)
      const target = options.remote === undefined ? { kind: "local" as const, address: value.thread } : await crossTarget(options.remote, value.thread, resolution(options, entries, value.thread, callerId, true))
      if (target.kind === "error") return target.result
      const remoteRow = target.kind === "remote" && options.remote !== undefined ? target.row : undefined
      const resolved = remoteRow === undefined ? resolution(options, entries, target.kind === "local" ? target.address : value.thread, callerId, localScope(target, value.all_scope)) : undefined
      if (resolved?.kind === "error") return { kind: "error", error: resolved }
      const threadId = remoteRow?.session_id ?? (resolved?.kind === "ok" ? resolved.entry.thread_id : value.thread)
      // Both legs run the same refusals, all before the alias or the name changes anywhere: first the target's own
      // liveness (a local thread with no live owner, as before the remote tools; a remote one on an offline device, A3),
      // then the name checks.
      const name = value.name?.trim()
      const session = remoteRow === undefined && name !== undefined ? targetSession(current, threadId) : undefined
      if (remoteRow === undefined && name !== undefined && session === undefined) return failure("not_resumable", "The thread has no live owner.", "Retry when the target is live.")
      if (remoteRow !== undefined && options.remote !== undefined) { const offline = await deviceOnline(options.remote, remoteRow.device); if (offline !== undefined) return offline }
      if (name !== undefined) {
        if (name.length === 0) return failure("invalid_arguments", "The new thread name is empty.", "Pass a non-empty name.")
        const visible = value.all_scope === true ? entries : workspaceEntries(entries, options.callerWorkspaceRoot())
        const existing = visible.find((entry) => entry.thread_id !== threadId && normalizeThreadName(entry.name) === normalizeThreadName(name))
        if (existing !== undefined) return failure("name_conflict", `A thread named "${existing.name}" already exists.`, "Call thread_list and choose another name.")
      }
      if (value.alias !== undefined) { const refused = await renameAlias(options.remote, threadId, remoteRow?.device, value.alias, operationId); if (refused !== undefined) return refused }
      if (remoteRow !== undefined && options.remote !== undefined) {
        if (name !== undefined) { const named = await options.remote.sessions.sessionCommand(remoteRow.device, remoteRow.session_id, { type: "set_session_name", sessionId: remoteRow.session_id, name }); if (named.kind !== "ok") return outcomeFailure(named, remoteRow.device) }
        return { kind: "ok", thread_id: remoteRow.session_id, name: name ?? remoteRow.title, ...(value.alias === undefined ? {} : { alias: value.alias }), device: remoteRow.device }
      }
      if (resolved?.kind !== "ok") return failure("not_found", "The thread could not be resolved.", "Call thread_list and retry.")
      if (name === undefined || session === undefined) return { kind: "ok", thread_id: threadId, name: resolved.entry.name, ...(value.alias === undefined ? {} : { alias: value.alias }) }
      await sessionPort(options, session).setSessionName(routingId(session), name, threadId)
      return { kind: "ok", thread_id: threadId, name, ...(value.alias === undefined ? {} : { alias: value.alias }) }
    }),
  }
  const setModel: AnyTool = {
    ...metadata("thread_set_model"),
    parameters: threadToolParamSchemas.thread_set_model,
    execute: (id: string, args: ThreadSetModelInput, _signal, _onUpdate, ectx) => execute("thread_set_model", id, args, ectx, async (current, value, _operationId, callerId) => {
      const target = options.remote === undefined ? { kind: "local" as const, address: value.thread } : await crossTarget(options.remote, value.thread, resolution(options, resolveEntries(options, current), value.thread, callerId, true))
      if (target.kind === "error") return target.result
      if (target.kind === "remote" && options.remote !== undefined) return await setModelRemote(options.remote, target.row, value)
      const resolved = resolution(options, resolveEntries(options, current), target.kind === "local" ? target.address : value.thread, callerId, localScope(target, value.all_scope))
      if (resolved.kind === "error") return { kind: "error", error: resolved }
      const session = targetSession(current, resolved.entry.thread_id)
      if (session === undefined) return failure("not_resumable", "The thread has no live owner.", "Retry when the target is live.")
      const empty = modelPatternFailure(value.model)
      if (empty !== undefined) return empty
      const matched = matchModel(await sessionPort(options, session).getAvailableModels(routingId(session)), value.model, value.provider)
      if (matched.kind !== "match") return matched
      const selected = await sessionPort(options, session).setModel(routingId(session), matched.model.provider, matched.model.id, resolved.entry.thread_id)
      return { kind: "ok", thread_id: resolved.entry.thread_id, model: { provider: selected.provider, id: selected.id } }
    }),
  }
  const setReasoning: AnyTool = {
    ...metadata("thread_set_reasoning"),
    parameters: threadToolParamSchemas.thread_set_reasoning,
    execute: (id: string, args: ThreadSetReasoningInput, _signal, _onUpdate, ectx) => execute("thread_set_reasoning", id, args, ectx, async (current, value, _operationId, callerId) => {
      const resolved = resolution(options, resolveEntries(options, current), value.thread, callerId, value.all_scope)
      if (resolved.kind === "error") return { kind: "error", error: resolved }
      const session = targetSession(current, resolved.entry.thread_id)
      if (session === undefined) return failure("not_resumable", "The thread has no live owner.", "Retry when the target is live.")
      try {
        await sessionPort(options, session).setThinkingLevel(routingId(session), value.level, value.scope === "turn" ? "turn" : undefined, resolved.entry.thread_id)
      } catch (error) {
        if (!(error instanceof Error) || !error.message.startsWith("thinking_level_unsupported:")) throw error
        const supported = await sessionPort(options, session).getAvailableThinkingLevels(routingId(session))
        return failure("thinking_level_unsupported", `Thinking level "${value.level}" is not supported by the active model.`, "Choose a level from the supported list and retry.", { supported })
      }
      return { kind: "ok", thread_id: resolved.entry.thread_id, level: value.level, scope: value.scope ?? "session" }
    }),
  }
  // K8 / R8.c: a send to another device continues the caller's own chain (its hop and root), and names its sender the way
  // a local delivery does (gateway/engine.ts senderFacts): the session, its name, and its workspace and project (#12852).
  async function remotePeer(callerId: string): Promise<RemotePeer> {
    const cause = options.callerCause?.()
    const prior = cause === undefined ? undefined : (await store.deliveryView(cause))?.row
    const name = options.callerName?.()?.trim()
    const deliveryId = randomUUID()
    const provenance = await senderProvenance()
    return {
      session_id: callerId,
      ...(name === undefined || name === "" ? {} : { name }),
      provenance: name === undefined || name === "" ? provenance : { ...provenance, session: name },
      delivery_id: deliveryId,
      root_id: prior?.root_id ?? deliveryId,
      hop: (prior?.hop ?? 0) + 1,
    }
  }
  async function openLocal(current: ThreadHostView, address: string, callerId: string): Promise<ThreadToolResult> {
    const resolved = resolution(options, toThreadAddressEntries(sendAddressBook(options, current, address, true)), address, callerId, true)
    if (resolved.kind === "error") return { kind: "error", error: resolved } as ThreadToolResult
    const live = targetSession(current, resolved.entry.thread_id)
    if (live !== undefined) return { kind: "ok", thread: summary(live), deduplicated: true }
    const entry = sendAddressBook(options, current, address, true).find((candidate) => candidate.thread_id === resolved.entry.thread_id)
    if (entry?.session_path === undefined || entry.session_path === null) return failure("not_resumable", "The thread has no session file on this device to open.", "Call thread_list and pick a thread it lists.")
    const session = await options.host.openSession({ sessionPath: entry.session_path })
    return { kind: "ok", thread: summary(session), deduplicated: false }
  }
  const relayTools = createRelayTools({ options, relay, view, failure })
  const dispose = () => {
    unanswered.clear()
    relay.dispose()
  }
  return { tools: [create, list, read, send, interrupt, close, handoff, rename, setModel, setReasoning, ...relayTools], dispose }

  /**
   * A send to another device has no gateway row to carry its idempotency, so it keeps the same promise through the
   * tool receipt store: a retry under the same key replays the first answer (deduplicated) and sends nothing.
   */
  async function remoteOnce(callerId: string, idempotencyKey: string, value: unknown, run: () => Promise<ThreadToolResult>): Promise<ThreadToolResult> {
    const scope = { principal: `session:${callerId}`, operation: "thread_send:remote", idempotency_key: idempotencyKey }
    const admission = await store.toolReceiptBegin({ ...scope, now: now(), args_hash: hashArgs(value) })
    if (admission.kind === "replay") { const first = admission.result as ThreadToolResult; return first.kind === "ok" && "deduplicated" in first ? { ...first, deduplicated: true } as ThreadToolResult : first }
    if (admission.kind === "conflict") return failure("idempotency_conflict", "The idempotency key was already used with different arguments.", "Retry with a new idempotency_key.")
    const note = unsettled.get(receiptKey(scope))
    if (admission.kind === "in_progress" && note !== undefined) return failure("idempotency_uncertain", "The earlier operation may have been delivered.", "Read the target transcript before deciding whether to retry.", { error_note: note })
    if (admission.kind === "in_progress") return failure("idempotency_in_progress", "The same operation is already in progress.", "Wait for the earlier call to settle, then retry.")
    if (admission.kind === "uncertain") return failure("idempotency_uncertain", "The earlier operation may have been delivered.", "Read the target transcript before deciding whether to retry.")
    const unrecorded = (what: string) => (settleError: unknown) => { unsettled.set(receiptKey(scope), `${what}, and its receipt could not be recorded: ${settleError instanceof Error ? settleError.message : String(settleError)}`) }
    let result: ThreadToolResult
    try {
      result = await run()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await store.toolReceiptSettle({ ...scope, now: now(), error_note: message }).catch(unrecorded(`the send failed (${message})`))
      throw error
    }
    await store.toolReceiptSettle({ ...scope, now: now(), result }).catch(unrecorded("the send ran"))
    return result
  }

  async function deliver(current: ThreadHostView, address: string, value: ThreadSendInput | ThreadHandoffInput, idempotencyKey: string, callerId: string, resolvedBy?: "exact_name" | "fuzzy"): Promise<ThreadToolResult> {
    let scope = value.all_scope
    if (options.remote !== undefined && current !== PUBLISHED_SEND_VIEW) {
      const target = await crossTarget(options.remote, address, resolution(options, toThreadAddressEntries(sendAddressBook(options, current, address, true)), address, callerId, true))
      if (target.kind === "error") return target.result
      if (target.kind === "remote") {
        const row = target.row
        const remote = options.remote
        // Before remoteOnce writes a receipt, exactly where a local gateway send refuses an unknown caller (deliverThroughGateway).
        if (callerId === UNKNOWN_CALLER) return failure("caller_context_missing", "A gateway send needs the calling session's durable id.", "Retry from a session that passes its execution context.")
        const request = { message: value.message, ...("delivery" in value && value.delivery !== undefined ? { delivery: value.delivery } : {}), ...("expected_turn_id" in value && value.expected_turn_id !== undefined ? { expected_turn_id: value.expected_turn_id } : {}) }
        const sent = await remoteOnce(callerId, idempotencyKey, value, async () => await promptRemote(remote, row, request, { kind: "peer", ...await remotePeer(callerId) }))
        if (resolvedBy === undefined || sent.kind !== "ok" || !("delivery" in sent)) return sent
        const seen = new Date(row.updated_ms).toISOString()
        return { kind: "ok", thread: { thread_id: row.session_id, name: row.title, status: "live", cwd: row.project, created_at: seen, updated_at: seen, device: row.device, link: threadLink(row.session_id, row.title) }, resolved_by: resolvedBy, delivery: sent.delivery, deduplicated: sent.deduplicated, device: row.device } as ThreadToolResult
      }
      address = target.address
      scope = localScope(target, value.all_scope)
    }
    if (current === PUBLISHED_SEND_VIEW) return await deliverThroughGateway(options, engine, current, address, value, idempotencyKey, callerId, resolvedBy)
    const resolved = resolution(options, toThreadAddressEntries(sendAddressBook(options, current, address, scope)), address, callerId, scope)
    if (resolved.kind === "error") return { kind: "error", error: resolved } as ThreadToolResult
    return await deliverThroughGateway(options, engine, current, resolved.entry.thread_id, { ...value, all_scope: scope }, idempotencyKey, callerId, resolvedBy)
  }
}

/**
 * The send path hands the durable id to the engine, which freshly validates the
 * published endpoint and caller's scope. The result keeps the send contract and
 * adds `delivery_id`, `effective_mode` and `endpoint.kind`; an unreachable target is
 * `queued_offline` (the row is durable). A chain may come back to a session it passed; only a
 * session sending to itself is refused `loop_detected`. Answers may also travel through thread_read,
 * thread_report and thread_answer.
 */
async function deliverThroughGateway(
  options: ThreadToolSurfaceOptions,
  engine: GatewayEngine,
  current: ThreadHostView,
  threadId: string,
  value: ThreadSendInput | ThreadHandoffInput,
  idempotencyKey: string,
  callerId: string,
  resolvedBy: "exact_name" | "fuzzy" | undefined,
): Promise<ThreadToolResult> {
  if (callerId === UNKNOWN_CALLER) return failure("caller_context_missing", "A gateway send needs the calling session's durable id.", "Retry from a session that passes its execution context.")
  let expected: number | undefined
  if (value.expected_turn_id !== undefined) {
    if (!/^\d+$/.test(value.expected_turn_id)) return failure("turn_conflict", `Turn ${value.expected_turn_id} is not a turn of the target session.`, "Read the target again and steer with the turn_id a started or steered result returned.")
    expected = Number(value.expected_turn_id)
  }
  const turn = options.callerTurnId?.()
  const cause = options.callerCause?.()
  const name = options.callerName?.()?.trim()
  const sent = await engine.deliver({
    sender: { kind: "session", durable_id: callerId, ...(name === undefined || name === "" ? {} : { name }), ...(turn === undefined ? {} : { turn_id: turn }), ...(cause === undefined ? {} : { cause_delivery_id: cause }) },
    target: threadId,
    text: value.message,
    mode: value.delivery ?? "auto",
    ...(expected === undefined ? {} : { expected_turn_id: expected }),
    all_scope: value.all_scope,
    idempotency_key: idempotencyKey,
  })
  if (sent.kind === "error") return { kind: "error", error: sent.error }
  const facts = { delivery_id: sent.delivery_id, effective_mode: sent.effective_mode, endpoint: sent.endpoint_kind === null ? null : { kind: sent.endpoint_kind } }
  if (resolvedBy === undefined) {
    const title = current.sessions.find((session) => (session.durableSessionId ?? session.sessionId) === threadId)?.name
    return { kind: "ok", thread_id: threadId, link: threadLink(threadId, title), delivery: sent.delivery, message_seq: sent.message_seq, deduplicated: sent.deduplicated, ...facts }
  }
  const session = targetSession(current, threadId)
  const entry = sendAddressBook(options, current, threadId, true).find((candidate) => candidate.thread_id === threadId)
  const thread = session !== undefined ? summary(session, entry) : entry !== undefined ? degradedSummary(entry) : undefined
  if (thread === undefined) return failure("not_found", `Thread ${threadId} is not in the address book.`, "Call thread_list and retry.")
  return { kind: "ok", thread, resolved_by: resolvedBy, delivery: sent.delivery, message_seq: sent.message_seq, deduplicated: sent.deduplicated, ...facts }
}

/**
 * Registers the eighteen tools, and with `pi.on` the store extensions' session tools at each `session_start`
 * (`tools/extension-tools.ts`); `dispose` (shutdown) cancels the relay's background retries and drops the receipt-recovery keys.
 */
export function registerThreadTools(pi: ExtensionToolHost, options: ThreadToolSurfaceOptions, log: (line: string) => void = () => undefined): { readonly dispose: () => void } {
  const built = buildThreadTools(options)
  // Thread tools run on the loop side of a split session (engine `ToolDefinition.runs`).
  for (const tool of built.tools) pi.registerTool({ ...tool, runs: "brain" })
  if (pi.on !== undefined) registerExtensionTools(pi as ExtensionToolHost & Required<Pick<ExtensionToolHost, "on">>, options, log)
  return { dispose: built.dispose }
}

