import type { AgentToolResult, ToolDefinition } from "@code-yeongyu/senpi"
import { type Static } from "typebox"
import { toGatewayAddressEntries } from "./address-book"
import { fuzzyMatch, resolveTarget, workspaceEntries, type ThreadAddressEntry } from "./addressing"
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
import { createOrderedDeliveryMailbox, type MailboxTargetPort } from "./mailbox"
import { THREAD_FAMILY_PROMPT_GUIDELINES, THREAD_TOOL_SEARCH_METADATA } from "./metadata"
import { readTranscript } from "./reader"
export type { ThreadTranscriptEntry } from "./reader"
import type { GatewayEndpointPort, GatewayEndpointRef } from "./gateway/adapter"
import { hashArgs } from "./gateway/bindings"
import { createGatewayEngine, resolveFromEntries } from "./gateway/engine"
import { createGatewayRelay } from "./gateway/relay"
import { createGatewayStore } from "./gateway/store"
import { createRelayTools } from "./tools/relay-tools"
export type { ThreadHost, ThreadHostSession, ThreadToolSurfaceOptions } from "./tools/ports"
export { UNKNOWN_CALLER } from "./tools/ports"
import { UNKNOWN_CALLER, type ThreadHost, type ThreadHostSession, type ThreadHostView, type ThreadToolSurfaceOptions } from "./tools/ports"
import {
  addressBook,
  degradedSummary,
  failure,
  hostView,
  metadata,
  output,
  resolution,
  resolveEntries,
  routingId,
  sessionPort,
  transcriptRole,
  summary,
  targetSession,
  type AnyTool,
  type ToolOutput,
} from "./tools/internals"

/** A host without the gateway port reaches no endpoint: every gateway send lands `queued_offline`. */
const UNREACHABLE: GatewayEndpointPort = {
  wake: async (endpoint) => {
    throw new Error(`host_unavailable:${endpoint.socket}`)
  },
}

export function createThreadTools(options: ThreadToolSurfaceOptions): readonly AnyTool[] {
  const now = options.now ?? Date.now
  const store = options.store ?? createGatewayStore({ agentDir: options.stateDirectory })
  const endpoints = options.host.gateway ?? UNREACHABLE
  const gatewayEntries = async () => toGatewayAddressEntries(addressBook(options, await view()))
  const engine = createGatewayEngine({ store, endpoints, resolve: resolveFromEntries(gatewayEntries, options.callerWorkspaceRoot), now })
  const locate = async (durableId: string): Promise<GatewayEndpointRef | null> => {
    const entry = (await gatewayEntries()).find((candidate) => candidate.thread_id === durableId)
    return entry === undefined || entry.liveness !== "routable" ? null : entry.endpoint
  }
  const relay = createGatewayRelay({ store, engine, endpoints, locate, now })
  const mailbox = createOrderedDeliveryMailbox({
    directory: `${options.stateDirectory}/mailbox`,
    portFor: (target): MailboxTargetPort | undefined => ({
      snapshot: async () => { const session = await findSession(target); const state = await sessionPort(options, session).getState(session.sessionId); return { active: state.isStreaming === true, ...(state.activeTurnId === undefined ? {} : { turn_id: state.activeTurnId }) } },
      steer: async (message, expected) => { const session = await findSession(target); await sessionPort(options, session).prompt(session.sessionId, message, { streamingBehavior: "steer" }); void expected },
      start: async (message) => { const session = await findSession(target); const result = await sessionPort(options, session).prompt(session.sessionId, message, { streamingBehavior: "followUp" }); return { turn_id: result.turnId ?? `turn-${Date.now()}` } },
    }),
  })

  async function view(): Promise<ThreadHostView> { await options.ensureHost?.(); return hostView(options) }
  async function findSession(id: string): Promise<ThreadHostSession> {
    const found = targetSession(await view(), id)
    if (found === undefined) throw new Error(`thread ${id} is not live`)
    return found
  }
  async function execute<T extends ThreadToolName>(name: T, callId: string, args: unknown, ectx: unknown, sideEffect: (view: ThreadHostView, value: Static<(typeof threadToolParamSchemas)[T]>, operationId: string, callerId: string) => Promise<ThreadToolResult>): Promise<ToolOutput> {
    const callerId = (ectx as { sessionManager?: { getSessionId?: () => string } } | undefined)?.sessionManager?.getSessionId?.() ?? options.callerSessionId()
    const parsed = parseThreadParams(threadToolParamSchemas[name], args)
    if (parsed.kind === "error") return output(parsed as ThreadToolResult)
    const value = parsed.value as Static<(typeof threadToolParamSchemas)[T]>
    const explicitKey = "idempotency_key" in value ? (value as { idempotency_key?: string }).idempotency_key?.trim() : undefined
    const scope = { principal: `session:${callerId}`, operation: name, idempotency_key: explicitKey !== undefined && explicitKey.length > 0 ? explicitKey : `call:${callId}` }
    // A gateway send owns its idempotency: the engine's receipt is written in the delivery's own
    // transaction and answers a lost ACK with `idempotency_uncertain` + the row state.
    const receipted = !((name === "thread_send" || name === "thread_handoff") && options.sendThroughGateway === true)
    if (receipted) {
      const admission = await store.toolReceiptBegin({ ...scope, now: now(), args_hash: hashArgs(value) })
      if (admission.kind === "replay") return output(admission.result as ThreadToolResult)
      if (admission.kind === "conflict") return output(failure("idempotency_conflict", "The idempotency key was already used with different arguments.", "Retry with a new idempotency_key."))
      if (admission.kind === "in_progress") return output(failure("idempotency_in_progress", "The same operation is already in progress.", "Wait for the earlier call to settle, then retry."))
      if (admission.kind === "uncertain") return output(failure("idempotency_uncertain", "The earlier operation may have been delivered.", "Read the target transcript before deciding whether to retry.", admission.error_note === null ? undefined : { error_note: admission.error_note }))
    }
    try {
      const result = await sideEffect(await view(), value, scope.idempotency_key, callerId)
      if (receipted) await store.toolReceiptSettle({ ...scope, now: now(), result })
      return output(result)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (receipted) await store.toolReceiptSettle({ ...scope, now: now(), error_note: message }).catch(() => false)
      if (message.startsWith("host_unavailable:")) {
        return output(failure("host_unavailable", `The thread host is unavailable at ${message.slice("host_unavailable:".length)}.`, "Retry when the shared Senpi host is running."))
      }
      if (message.startsWith("unsupported:")) {
        return output(failure("unsupported", `The target's endpoint does not accept ${message.slice("unsupported:".length)}: a terminal session only takes messages through its own inbox.`, "Use thread_read to follow the terminal session, or act on a thread served by a host.", { command: message.slice("unsupported:".length) }))
      }
      return output(failure("internal_error", `Thread operation failed: ${message}`, "Call thread_list and retry after checking the target."))
    }
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
    execute: (id: string, args: ThreadListInput, _signal, _onUpdate, ectx) => execute("thread_list", id, args, ectx, async (current, value) => {
      // Default scope is the caller's workspace, the same test thread_send applies before it
      // delivers; the address book itself spans every workspace the host knows.
      const scoped = workspaceEntries(resolveEntries(options, current), options.callerWorkspaceRoot())
      const inScope = (threadId: string) => value.all_scope === true || scoped.some((entry) => entry.thread_id === threadId)
      const visible = current.sessions.filter((session) => inScope(session.durableSessionId ?? session.sessionId))
      const book = addressBook(options, current)
      const entryOf = (session: ThreadHostSession) => book.find((entry) => entry.thread_id === (session.durableSessionId ?? session.sessionId) && entry.source_host === (session.socket ?? entry.source_host))
      // A session whose endpoint stopped answering is still a thread: it is listed from its JSONL
      // as resumable, with the endpoint's failure in error_note, instead of silently vanishing.
      const degraded = book.filter((entry) => entry.error_note !== undefined && entry.status !== "live" && inScope(entry.thread_id))
      return { kind: "ok", threads: [...visible.map((session) => summary(session, entryOf(session))), ...degraded.map(degradedSummary)], scope: value.all_scope === true ? "all" : "workspace" }
    }),
  }
  const read: AnyTool = { ...metadata("thread_read"), parameters: threadToolParamSchemas.thread_read, execute: (id: string, args: ThreadReadInput, _signal, _onUpdate, ectx) => execute("thread_read", id, args, ectx, async (current, value, _operationId, callerId) => { const resolved = resolution(options, resolveEntries(options, current), value.thread, callerId, value.all_scope); if (resolved.kind === "error") return { kind: "error", error: resolved } as ThreadToolResult; const session = targetSession(current, resolved.entry.thread_id); if (session === undefined) return readDegraded(current, resolved.entry.thread_id, value); const messages = await sessionPort(options, session).getMessages(routingId(session)); const live = readTranscript({ kind: "live", entries: () => messages }, { mode: "tail", max_bytes: value.max_bytes, cursor: value.cursor }); if (live.kind === "error") return { kind: "error", error: live.error }; return { kind: "ok", thread_id: resolved.entry.thread_id, items: live.items.map((item, index) => ({ seq: index + 1, role: transcriptRole(item.role), content: JSON.stringify(item.content ?? item) })), truncated: live.truncated, ...(live.next_cursor === null ? {} : { next_cursor: live.next_cursor }), source: live.source } }) }
  const send: AnyTool = { ...metadata("thread_send"), parameters: threadToolParamSchemas.thread_send, execute: (id: string, args: ThreadSendInput, _signal, _onUpdate, ectx) => execute("thread_send", id, args, ectx, async (current, value, operationId, callerId) => deliver(current, value.thread, value, operationId, callerId)) }
  const interrupt: AnyTool = { ...metadata("thread_interrupt"), parameters: threadToolParamSchemas.thread_interrupt, execute: (id: string, args: ThreadInterruptInput, _signal, _onUpdate, ectx) => execute("thread_interrupt", id, args, ectx, async (current, value, _operationId, callerId) => { const resolved = resolution(options, resolveEntries(options, current), value.thread, callerId, value.all_scope); if (resolved.kind === "error") return { kind: "error", error: resolved } as ThreadToolResult; const session = targetSession(current, resolved.entry.thread_id); if (session === undefined) return failure("not_resumable", "The thread has no live owner.", "Retry when the target is live."); const result = await sessionPort(options, session).interrupt(session.sessionId, value.turn_id); return { kind: "ok", thread_id: resolved.entry.thread_id, ...(result.turnId === undefined ? {} : { turn_id: result.turnId }), interrupted: result.interrupted === true } }) }
  const handoff: AnyTool = { ...metadata("thread_handoff"), parameters: threadToolParamSchemas.thread_handoff, execute: (id: string, args: ThreadHandoffInput, _signal, _onUpdate, ectx) => execute("thread_handoff", id, args, ectx, async (current, value, operationId, callerId) => { const entries = resolveEntries(options, current); const resolved = value.match === "fuzzy" ? fuzzyMatch(entries.filter((entry) => entry.thread_id !== callerId), value.thread) : resolution(options, entries, value.thread, callerId, value.all_scope); if (resolved.kind === "error") return { kind: "error", error: resolved } as ThreadToolResult; return deliver(current, resolved.entry.thread_id, value, operationId, callerId, value.match === "fuzzy" ? "fuzzy" : "exact_name") }) }
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
  return [create, list, read, send, interrupt, handoff, rename, setModel, setReasoning, ...relayTools]

  /**
   * A thread with no live owner is read from its JSONL only when its ENDPOINT is dead: the address
   * book then carries the durable path and the endpoint's failure. Any other non-live thread stays
   * `not_resumable`, as before endpoints were enumerated.
   */
  function readDegraded(current: ThreadHostView, threadId: string, value: ThreadReadInput): ThreadToolResult {
    const entry = addressBook(options, current).find((candidate) => candidate.thread_id === threadId)
    if (entry === undefined || entry.error_note === undefined || entry.session_path === null) return failure("not_resumable", "The thread has no live owner.", "Retry when the target is live.")
    const durable = readTranscript({ kind: "jsonl", path: entry.session_path, live_host_present: false }, { mode: "tail", max_bytes: value.max_bytes, cursor: value.cursor })
    if (durable.kind === "error") return { kind: "error", error: durable.error }
    // A session file interleaves messages with bookkeeping (the session header, model and thinking
    // changes, names): only message entries are transcript, rendered with the live path's roles.
    const messages = durable.items.flatMap((item) => {
      const message = item.message
      if (item.type !== "message" || typeof message !== "object" || message === null || Array.isArray(message)) return []
      return message.role === "user" || message.role === "assistant" || message.role === "toolResult" ? [message] : []
    })
    const items = messages.map((message, index) => ({ seq: index + 1, role: transcriptRole(message.role), content: JSON.stringify(message.content ?? message) }))
    return { kind: "ok", thread_id: threadId, items, truncated: durable.truncated, ...(durable.next_cursor === null ? {} : { next_cursor: durable.next_cursor }), source: durable.source, source_incomplete: durable.source_incomplete, error_note: entry.error_note }
  }

  function deliverThroughGateway(current: ThreadHostView, threadId: string, value: ThreadSendInput | ThreadHandoffInput, idempotencyKey: string, callerId: string, resolvedBy?: "exact_name" | "fuzzy"): Promise<ThreadToolResult> {
    return deliverThroughGatewayImpl(options, engine, current, threadId, value, idempotencyKey, callerId, resolvedBy)
  }

  async function deliver(current: ThreadHostView, address: string, value: ThreadSendInput | ThreadHandoffInput, idempotencyKey: string, callerId: string, resolvedBy?: "exact_name" | "fuzzy"): Promise<ThreadToolResult> {
    const resolved = resolution(options, resolveEntries(options, current), address, callerId, value.all_scope)
    if (resolved.kind === "error") return { kind: "error", error: resolved } as ThreadToolResult
    if (options.sendThroughGateway === true) return await deliverThroughGateway(current, resolved.entry.thread_id, value, idempotencyKey, callerId, resolvedBy)
    const session = targetSession(current, resolved.entry.thread_id)
    if (session === undefined) return failure("not_resumable", "The thread has no live owner.", "Retry when the target is live.")
    // A terminal is never prompted: it takes messages only through the gateway inbox its own
    // extension drains, which this mailbox path does not write.
    if (session.endpoint_kind === "tui") return failure("unsupported", `Thread ${resolved.entry.thread_id} is a terminal session, which takes messages only through the session gateway.`, "Use thread_read to follow it; delivery to terminal sessions arrives with the gateway send path.", { endpoint_kind: "tui" })
    const result = await mailbox.accept(resolved.entry.thread_id, value.message, { delivery: value.delivery, expected_turn_id: value.expected_turn_id })
    if (result.kind === "error") return { kind: "error", error: result.error }
    const delivery = result.delivery === "queued"
      ? { kind: "queued" as const, queue_position: result.queue_position }
      : { kind: result.delivery, turn_id: result.turn_id }
    const base = { kind: "ok" as const, thread_id: resolved.entry.thread_id, delivery, message_seq: result.message_seq, deduplicated: false }
    return resolvedBy === undefined ? base : { kind: "ok", thread: summary(session), resolved_by: resolvedBy, delivery, message_seq: result.message_seq, deduplicated: false }
  }
}

/**
 * The gateway send path, behind the component's send switch: resolution already applied the
 * caller's scope, so the engine is handed the durable id. The result keeps the send contract and
 * adds `delivery_id`, `effective_mode` and `endpoint.kind`; an unreachable target is
 * `queued_offline` (the row is durable). A direct reply to the session that messaged this one
 * under the same causal root is refused `loop_detected`: answers travel through thread_read,
 * thread_report and thread_answer.
 */
async function deliverThroughGatewayImpl(
  options: ThreadToolSurfaceOptions,
  engine: ReturnType<typeof createGatewayEngine>,
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
  const entry = addressBook(options, current).find((candidate) => candidate.thread_id === threadId)
  const thread = session !== undefined ? summary(session, entry) : entry !== undefined ? degradedSummary(entry) : undefined
  if (thread === undefined) return failure("not_found", `Thread ${threadId} is not in the address book.`, "Call thread_list and retry.")
  return { kind: "ok", thread, resolved_by: resolvedBy, delivery: sent.delivery, message_seq: sent.message_seq, deduplicated: sent.deduplicated, ...facts }
}

export function registerThreadTools(pi: { registerTool(tool: Record<string, unknown>): void }, options: ThreadToolSurfaceOptions): void {
  for (const tool of createThreadTools(options)) pi.registerTool({ ...tool })
}

