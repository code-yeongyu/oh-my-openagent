import type { AgentToolResult, ToolDefinition } from "@code-yeongyu/senpi"
import { type Static } from "typebox"
import { toThreadAddressEntries } from "./address-book"
import { fuzzyMatch, workspaceEntries } from "./addressing"
import {
  parseThreadParams,
  threadToolParamSchemas,
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
export type { ThreadTranscriptEntry } from "./reader"
import { hashArgs } from "./gateway/bindings"
import type { GatewayEngine } from "./gateway/engine"
import { isLockWaitExceeded } from "./gateway/lock-wait"
import { createGatewayServices } from "./tools/gateway-services"
import { listThreads, readThread } from "./tools/read-ops"
import { createRelayTools } from "./tools/relay-tools"
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

export function createThreadTools(options: ThreadToolSurfaceOptions): readonly AnyTool[] {
  return buildThreadTools(options).tools
}

function buildThreadTools(options: ThreadToolSurfaceOptions): { readonly tools: readonly AnyTool[]; readonly dispose: () => void } {
  const { store, engine, relay } = createGatewayServices(options, () => view({ offline: true }))
  const now = options.now ?? store.now
  async function view(request?: ThreadHostViewRequest): Promise<ThreadHostView> { await options.ensureHost?.(); return hostView(options, request) }
  // Receipts this process began but could not settle (the store gave up at its lock-wait bound):
  // the row stays `prepared` under this instance, which would answer `idempotency_in_progress`
  // forever. A retry of such a key is `idempotency_uncertain` with the note instead.
  const unsettled = new Map<string, string>()
  // Keys whose receipt admission failed without a reply: the store may still have committed the
  // prepared row (its worker exited after the commit), which this instance's retry would read as
  // `in_progress` forever. Nothing ran for such a call, so a retry that finds that row while no
  // invocation of this facade is running the key takes it up and runs the call.
  const unanswered = new Set<string>()
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
      let admission: Awaited<ReturnType<typeof store.toolReceiptBegin>>
      try {
        admission = await store.toolReceiptBegin({ ...scope, now: now(), args_hash: hashArgs(value) })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (isLockWaitExceeded(error)) return output(failure("overloaded", `The gateway store is locked by another process; nothing ran: ${message}`, "Wait a few seconds, then retry the call."))
        unanswered.add(receiptKey(scope))
        return output(failure("internal_error", `The gateway store could not record the call; nothing ran: ${message}`, "Retry the call; if it keeps failing, check the gateway store."))
      }
      const key = receiptKey(scope)
      if (admission.kind === "in_progress" && unanswered.has(key) && !running.has(key) && !unsettled.has(key)) admission = { kind: "accepted" }
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
      result = await sideEffect(await view(receipted ? undefined : { offline: true }), value, scope.idempotency_key, callerId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (receipted) await store.toolReceiptSettle({ ...scope, now: now(), error_note: message }).catch(unrecorded(`the call failed (${message})`))
      running.delete(receiptKey(scope))
      if (message.startsWith("host_unavailable:")) {
        return output(failure("host_unavailable", `The thread host is unavailable at ${message.slice("host_unavailable:".length)}.`, "Retry when the shared Senpi host is running."))
      }
      if (message.startsWith("unsupported:")) {
        return output(failure("unsupported", `The target's endpoint does not accept ${message.slice("unsupported:".length)}: a terminal session only takes messages through its own inbox.`, "Use thread_read to follow the terminal session, or act on a thread served by a host.", { command: message.slice("unsupported:".length) }))
      }
      return output(failure("internal_error", `Thread operation failed: ${message}`, "Call thread_list and retry after checking the target."))
    }
    if (receipted) await store.toolReceiptSettle({ ...scope, now: now(), result }).catch(unrecorded("the call ran"))
    running.delete(receiptKey(scope))
    return output(result)
  }

  const create: AnyTool = { ...metadata("thread_create"), parameters: threadToolParamSchemas.thread_create, promptGuidelines: [THREAD_FAMILY_PROMPT_GUIDELINES], execute: (id: string, args: ThreadCreateInput, _signal, _onUpdate, ectx) => execute("thread_create", id, args, ectx, async (current, value) => {
    const entries = resolveEntries(options, current)
    if (value.name !== undefined) { const existing = entries.find((entry) => entry.name.toLowerCase() === value.name?.trim().toLowerCase()); if (existing !== undefined) return failure("name_conflict", `A thread named "${existing.name}" already exists.`, "Call thread_list and choose another name.") }
    const session = await options.host.openSession({ cwd: value.cwd, forkFrom: value.fork_from, name: value.name })
    return { kind: "ok", thread: summary(session), deduplicated: false }
  }) }
  const list: AnyTool = {
    ...metadata("thread_list"),
    parameters: threadToolParamSchemas.thread_list,
    execute: (id: string, args: ThreadListInput, _signal, _onUpdate, ectx) => execute("thread_list", id, args, ectx, async (current, value) => listThreads(options, current, value.all_scope)),
  }
  const read: AnyTool = { ...metadata("thread_read"), parameters: threadToolParamSchemas.thread_read, execute: (id: string, args: ThreadReadInput, _signal, _onUpdate, ectx) => execute("thread_read", id, args, ectx, async (current, value, _operationId, callerId) => readThread(options, current, value, callerId)) }
  const send: AnyTool = { ...metadata("thread_send"), parameters: threadToolParamSchemas.thread_send, execute: (id: string, args: ThreadSendInput, _signal, _onUpdate, ectx) => execute("thread_send", id, args, ectx, async (current, value, operationId, callerId) => deliver(current, value.thread, value, operationId, callerId)) }
  const interrupt: AnyTool = { ...metadata("thread_interrupt"), parameters: threadToolParamSchemas.thread_interrupt, execute: (id: string, args: ThreadInterruptInput, _signal, _onUpdate, ectx) => execute("thread_interrupt", id, args, ectx, async (current, value, _operationId, callerId) => { const resolved = resolution(options, resolveEntries(options, current), value.thread, callerId, value.all_scope); if (resolved.kind === "error") return { kind: "error", error: resolved } as ThreadToolResult; const session = targetSession(current, resolved.entry.thread_id); if (session === undefined) return failure("not_resumable", "The thread has no live owner.", "Retry when the target is live."); const result = await sessionPort(options, session).interrupt(session.sessionId, value.turn_id); return { kind: "ok", thread_id: resolved.entry.thread_id, ...(result.turnId === undefined ? {} : { turn_id: result.turnId }), interrupted: result.interrupted === true } }) }
  const handoff: AnyTool = { ...metadata("thread_handoff"), parameters: threadToolParamSchemas.thread_handoff, execute: (id: string, args: ThreadHandoffInput, _signal, _onUpdate, ectx) => execute("thread_handoff", id, args, ectx, async (current, value, operationId, callerId) => { const entries = value.match === "fuzzy" ? resolveEntries(options, current) : toThreadAddressEntries(sendAddressBook(options, current, value.thread, value.all_scope)); const resolved = value.match === "fuzzy" ? fuzzyMatch(entries.filter((entry) => entry.thread_id !== callerId), value.thread) : resolution(options, entries, value.thread, callerId, value.all_scope); if (resolved.kind === "error") return { kind: "error", error: resolved } as ThreadToolResult; return deliver(current, resolved.entry.thread_id, value, operationId, callerId, value.match === "fuzzy" ? "fuzzy" : "exact_name") }) }
  const rename: AnyTool = {
    ...metadata("thread_rename"),
    parameters: threadToolParamSchemas.thread_rename,
    execute: (id: string, args: ThreadRenameInput, _signal, _onUpdate, ectx) => execute("thread_rename", id, args, ectx, async (current, value, _operationId, callerId) => {
      const entries = resolveEntries(options, current)
      const resolved = resolution(options, entries, value.thread, callerId, value.all_scope)
      if (resolved.kind === "error") return { kind: "error", error: resolved }
      const session = targetSession(current, resolved.entry.thread_id)
      if (session === undefined) return failure("not_resumable", "The thread has no live owner.", "Retry when the target is live.")
      const name = value.name.trim()
      if (name.length === 0) return failure("invalid_arguments", "The new thread name is empty.", "Pass a non-empty name.")
      const visible = value.all_scope === true ? entries : workspaceEntries(entries, options.callerWorkspaceRoot())
      const existing = visible.find((entry) => entry.thread_id !== resolved.entry.thread_id && entry.name.trim().toLowerCase() === name.toLowerCase())
      if (existing !== undefined) return failure("name_conflict", `A thread named "${existing.name}" already exists.`, "Call thread_list and choose another name.")
      await sessionPort(options, session).setSessionName(routingId(session), name)
      return { kind: "ok", thread_id: resolved.entry.thread_id, name }
    }),
  }
  const setModel: AnyTool = {
    ...metadata("thread_set_model"),
    parameters: threadToolParamSchemas.thread_set_model,
    execute: (id: string, args: ThreadSetModelInput, _signal, _onUpdate, ectx) => execute("thread_set_model", id, args, ectx, async (current, value, _operationId, callerId) => {
      const resolved = resolution(options, resolveEntries(options, current), value.thread, callerId, value.all_scope)
      if (resolved.kind === "error") return { kind: "error", error: resolved }
      const session = targetSession(current, resolved.entry.thread_id)
      if (session === undefined) return failure("not_resumable", "The thread has no live owner.", "Retry when the target is live.")
      const pattern = value.model.trim().toLowerCase()
      if (pattern.length === 0) return failure("invalid_arguments", "The model pattern is empty.", "Pass a model id or display-name fragment.")
      const catalog = await sessionPort(options, session).getAvailableModels(routingId(session))
      const available = value.provider === undefined ? catalog : catalog.filter((model) => model.provider.toLowerCase() === value.provider?.trim().toLowerCase())
      let matches = available.filter((model) => `${model.provider}/${model.id}`.toLowerCase() === pattern)
      if (matches.length === 0) matches = available.filter((model) => model.id.toLowerCase() === pattern)
      if (matches.length === 0) matches = available.filter((model) => model.id.toLowerCase().includes(pattern) || model.name?.toLowerCase().includes(pattern))
      if (matches.length === 0) return failure("model_not_found", `No available model matches "${value.model}".`, "Choose a provider/id from the available list and retry.", { available: catalog.slice(0, 20).map((model) => `${model.provider}/${model.id}`) })
      if (matches.length > 1) return failure("model_ambiguous", `Several available models match "${value.model}".`, "Pass an exact provider/id or narrow the pattern with provider.", { candidates: matches.slice(0, 10).map((model) => `${model.provider}/${model.id}`) })
      const selected = await sessionPort(options, session).setModel(routingId(session), matches[0].provider, matches[0].id)
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
        await sessionPort(options, session).setThinkingLevel(routingId(session), value.level, value.scope === "turn" ? "turn" : undefined)
      } catch (error) {
        if (!(error instanceof Error) || !error.message.startsWith("thinking_level_unsupported:")) throw error
        const supported = await sessionPort(options, session).getAvailableThinkingLevels(routingId(session))
        return failure("thinking_level_unsupported", `Thinking level "${value.level}" is not supported by the active model.`, "Choose a level from the supported list and retry.", { supported })
      }
      return { kind: "ok", thread_id: resolved.entry.thread_id, level: value.level, scope: value.scope ?? "session" }
    }),
  }
  const relayTools = createRelayTools({ options, relay, view, failure })
  return { tools: [create, list, read, send, interrupt, handoff, rename, setModel, setReasoning, ...relayTools], dispose: relay.dispose }

  async function deliver(current: ThreadHostView, address: string, value: ThreadSendInput | ThreadHandoffInput, idempotencyKey: string, callerId: string, resolvedBy?: "exact_name" | "fuzzy"): Promise<ThreadToolResult> {
    const resolved = resolution(options, toThreadAddressEntries(sendAddressBook(options, current, address, value.all_scope)), address, callerId, value.all_scope)
    if (resolved.kind === "error") return { kind: "error", error: resolved } as ThreadToolResult
    return await deliverThroughGateway(options, engine, current, resolved.entry.thread_id, value, idempotencyKey, callerId, resolvedBy)
  }
}

/**
 * The send path: resolution already applied the
 * caller's scope, so the engine is handed the durable id. The result keeps the send contract and
 * adds `delivery_id`, `effective_mode` and `endpoint.kind`; an unreachable target is
 * `queued_offline` (the row is durable). A direct reply to the session that messaged this one
 * under the same causal root is refused `loop_detected`: answers travel through thread_read,
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
  const sent = await engine.deliver({
    sender: { kind: "session", durable_id: callerId, ...(turn === undefined ? {} : { turn_id: turn }), ...(cause === undefined ? {} : { cause_delivery_id: cause }) },
    target: threadId,
    text: value.message,
    mode: value.delivery ?? "auto",
    ...(expected === undefined ? {} : { expected_turn_id: expected }),
    all_scope: true,
    idempotency_key: idempotencyKey,
  })
  if (sent.kind === "error") return { kind: "error", error: sent.error }
  const facts = { delivery_id: sent.delivery_id, effective_mode: sent.effective_mode, endpoint: sent.endpoint_kind === null ? null : { kind: sent.endpoint_kind } }
  if (resolvedBy === undefined) return { kind: "ok", thread_id: threadId, delivery: sent.delivery, message_seq: sent.message_seq, deduplicated: sent.deduplicated, ...facts }
  const session = targetSession(current, threadId)
  const entry = sendAddressBook(options, current, threadId, true).find((candidate) => candidate.thread_id === threadId)
  const thread = session !== undefined ? summary(session, entry) : entry !== undefined ? degradedSummary(entry) : undefined
  if (thread === undefined) return failure("not_found", `Thread ${threadId} is not in the address book.`, "Call thread_list and retry.")
  return { kind: "ok", thread, resolved_by: resolvedBy, delivery: sent.delivery, message_seq: sent.message_seq, deduplicated: sent.deduplicated, ...facts }
}

/** Registers the seventeen tools; `dispose` (shutdown) cancels the relay's background retries. */
export function registerThreadTools(pi: { registerTool(tool: Record<string, unknown>): void }, options: ThreadToolSurfaceOptions): { readonly dispose: () => void } {
  const built = buildThreadTools(options)
  for (const tool of built.tools) pi.registerTool({ ...tool })
  return { dispose: built.dispose }
}

