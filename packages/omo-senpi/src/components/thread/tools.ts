import type { AgentToolResult, ToolDefinition } from "@code-yeongyu/senpi"
import { type Static } from "typebox"
import { assembleAddressBook, toThreadAddressEntries, type AddressBookHost, type DiskSession } from "./address-book"
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
import { threadToolFailure, type ThreadErrorCode } from "./errors"
import { createOrderedDeliveryMailbox, type MailboxTargetPort } from "./mailbox"
import { THREAD_FAMILY_PROMPT_GUIDELINES, THREAD_TOOL_SEARCH_METADATA } from "./metadata"
import { readTranscript, type ThreadTranscriptEntry } from "./reader"
export type { ThreadTranscriptEntry } from "./reader"
import { createReceiptStore, type ReceiptStore } from "./receipts"
export type { ThreadHost, ThreadHostSession, ThreadToolSurfaceOptions } from "./tools/ports"
export { UNKNOWN_CALLER } from "./tools/ports"
import { UNKNOWN_CALLER, type ThreadHost, type ThreadHostSession, type ThreadToolSurfaceOptions } from "./tools/ports"
import {
  failure,
  makeReceipts,
  metadata,
  output,
  resolution,
  resolveEntries,
  routingId,
  summary,
  targetSession,
  type AnyTool,
  type ToolOutput,
} from "./tools/internals"

export function createThreadTools(options: ThreadToolSurfaceOptions): readonly AnyTool[] {
  const receipts = makeReceipts(options)
  const mailbox = createOrderedDeliveryMailbox({
    directory: `${options.stateDirectory}/mailbox`,
    portFor: (target): MailboxTargetPort | undefined => ({
      snapshot: async () => { const session = await findSession(target); const state = await options.host.getState(session.sessionId); return { active: state.isStreaming === true, ...(state.activeTurnId === undefined ? {} : { turn_id: state.activeTurnId }) } },
      steer: async (message, expected) => { await options.host.prompt((await findSession(target)).sessionId, message, { streamingBehavior: "steer" }); void expected },
      start: async (message) => { const result = await options.host.prompt((await findSession(target)).sessionId, message, { streamingBehavior: "followUp" }); return { turn_id: result.turnId ?? `turn-${Date.now()}` } },
    }),
  })

  async function sessions(): Promise<readonly ThreadHostSession[]> { await options.ensureHost?.(); return options.host.listSessions() }
  async function findSession(id: string): Promise<ThreadHostSession> {
    const found = targetSession(await sessions(), id)
    if (found === undefined) throw new Error(`thread ${id} is not live`)
    return found
  }
  async function execute<T extends ThreadToolName>(name: T, callId: string, args: unknown, ectx: unknown, sideEffect: (sessions: readonly ThreadHostSession[], value: Static<(typeof threadToolParamSchemas)[T]>, operationId: string, callerId: string) => Promise<ThreadToolResult>): Promise<ToolOutput> {
    const callerId = (ectx as { sessionManager?: { getSessionId?: () => string } } | undefined)?.sessionManager?.getSessionId?.() ?? options.callerSessionId()
    const parsed = parseThreadParams(threadToolParamSchemas[name], args)
    if (parsed.kind === "error") return output(parsed as ThreadToolResult)
    const value = parsed.value as Static<(typeof threadToolParamSchemas)[T]>
    const admission = receipts.begin({ caller_session_id: callerId, tool: name, args: value, idempotency_key: "idempotency_key" in value ? (value as { idempotency_key?: string }).idempotency_key : undefined, tool_call_id: callId })
    if (admission.kind === "replay") return output(admission.result as ThreadToolResult)
    if (admission.kind === "conflict") return output(failure("idempotency_conflict", "The idempotency key was already used with different arguments.", "Retry with a new idempotency_key."))
    if (admission.kind === "in_progress") return output(failure("idempotency_in_progress", "The same operation is already in progress.", "Wait for the earlier call to settle, then retry."))
    if (admission.kind === "uncertain") return output(failure("idempotency_uncertain", "The earlier operation may have been delivered.", "Read the target transcript before deciding whether to retry."))
    try {
      const result = await sideEffect(await sessions(), value, admission.operation_id, callerId)
      receipts.complete(admission, result)
      return output(result)
    } catch (error) {
      receipts.abandon(admission, error instanceof Error ? error.message : String(error))
      const message = error instanceof Error ? error.message : String(error)
      if (message.startsWith("host_unavailable:")) {
        return output(failure("host_unavailable", `The thread host is unavailable at ${message.slice("host_unavailable:".length)}.`, "Retry when the shared Senpi host is running."))
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
      const visible = value.all_scope === true
        ? current
        : current.filter((session) => scoped.some((entry) => entry.thread_id === (session.durableSessionId ?? session.sessionId)))
      return { kind: "ok", threads: visible.map(summary), scope: value.all_scope === true ? "all" : "workspace" }
    }),
  }
  const read: AnyTool = { ...metadata("thread_read"), parameters: threadToolParamSchemas.thread_read, execute: (id: string, args: ThreadReadInput, _signal, _onUpdate, ectx) => execute("thread_read", id, args, ectx, async (current, value, _operationId, callerId) => { const resolved = resolution(options, resolveEntries(options, current), value.thread, callerId, value.all_scope); if (resolved.kind === "error") return { kind: "error", error: resolved } as ThreadToolResult; const session = targetSession(current, resolved.entry.thread_id); if (session === undefined) return failure("not_resumable", "The thread has no live owner.", "Retry when the target is live."); const messages = await options.host.getMessages(routingId(session)); const live = readTranscript({ kind: "live", entries: () => messages }, { mode: "tail", max_bytes: value.max_bytes, cursor: value.cursor }); if (live.kind === "error") return { kind: "error", error: live.error }; return { kind: "ok", thread_id: resolved.entry.thread_id, items: live.items.map((item, index) => ({ seq: index + 1, role: item.role === "user" || item.role === "assistant" || item.role === "system" ? item.role : "system", content: JSON.stringify(item.content ?? item) })), truncated: live.truncated, ...(live.next_cursor === null ? {} : { next_cursor: live.next_cursor }), source: live.source } }) }
  const send: AnyTool = { ...metadata("thread_send"), parameters: threadToolParamSchemas.thread_send, execute: (id: string, args: ThreadSendInput, _signal, _onUpdate, ectx) => execute("thread_send", id, args, ectx, async (current, value, operationId, callerId) => deliver(current, value.thread, value, operationId, callerId)) }
  const interrupt: AnyTool = { ...metadata("thread_interrupt"), parameters: threadToolParamSchemas.thread_interrupt, execute: (id: string, args: ThreadInterruptInput, _signal, _onUpdate, ectx) => execute("thread_interrupt", id, args, ectx, async (current, value, _operationId, callerId) => { const resolved = resolution(options, resolveEntries(options, current), value.thread, callerId, value.all_scope); if (resolved.kind === "error") return { kind: "error", error: resolved } as ThreadToolResult; const session = targetSession(current, resolved.entry.thread_id); if (session === undefined) return failure("not_resumable", "The thread has no live owner.", "Retry when the target is live."); const result = await options.host.interrupt(session.sessionId, value.turn_id); return { kind: "ok", thread_id: resolved.entry.thread_id, ...(result.turnId === undefined ? {} : { turn_id: result.turnId }), interrupted: result.interrupted === true } }) }
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
      await options.host.setSessionName(routingId(session), name)
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
      const catalog = await options.host.getAvailableModels(routingId(session))
      const available = value.provider === undefined ? catalog : catalog.filter((model) => model.provider.toLowerCase() === value.provider?.trim().toLowerCase())
      let matches = available.filter((model) => `${model.provider}/${model.id}`.toLowerCase() === pattern)
      if (matches.length === 0) matches = available.filter((model) => model.id.toLowerCase() === pattern)
      if (matches.length === 0) matches = available.filter((model) => model.id.toLowerCase().includes(pattern) || model.name?.toLowerCase().includes(pattern))
      if (matches.length === 0) return failure("model_not_found", `No available model matches "${value.model}".`, "Choose a provider/id from the available list and retry.", { available: catalog.slice(0, 20).map((model) => `${model.provider}/${model.id}`) })
      if (matches.length > 1) return failure("model_ambiguous", `Several available models match "${value.model}".`, "Pass an exact provider/id or narrow the pattern with provider.", { candidates: matches.slice(0, 10).map((model) => `${model.provider}/${model.id}`) })
      const selected = await options.host.setModel(routingId(session), matches[0].provider, matches[0].id)
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
        await options.host.setThinkingLevel(routingId(session), value.level, value.scope === "turn" ? "turn" : undefined)
      } catch (error) {
        if (!(error instanceof Error) || !error.message.startsWith("thinking_level_unsupported:")) throw error
        const supported = await options.host.getAvailableThinkingLevels(routingId(session))
        return failure("thinking_level_unsupported", `Thinking level "${value.level}" is not supported by the active model.`, "Choose a level from the supported list and retry.", { supported })
      }
      return { kind: "ok", thread_id: resolved.entry.thread_id, level: value.level, scope: value.scope ?? "session" }
    }),
  }
  return [create, list, read, send, interrupt, handoff, rename, setModel, setReasoning]

  async function deliver(current: readonly ThreadHostSession[], address: string, value: ThreadSendInput | ThreadHandoffInput, operationId: string, callerId: string, resolvedBy?: "exact_name" | "fuzzy"): Promise<ThreadToolResult> {
    const resolved = resolution(options, resolveEntries(options, current), address, callerId, value.all_scope)
    if (resolved.kind === "error") return { kind: "error", error: resolved } as ThreadToolResult
    const session = targetSession(current, resolved.entry.thread_id)
    if (session === undefined) return failure("not_resumable", "The thread has no live owner.", "Retry when the target is live.")
    const result = await mailbox.accept(resolved.entry.thread_id, value.message, { delivery: value.delivery, expected_turn_id: value.expected_turn_id })
    if (result.kind === "error") return { kind: "error", error: result.error }
    const delivery = result.delivery === "queued"
      ? { kind: "queued" as const, queue_position: result.queue_position }
      : { kind: result.delivery, turn_id: result.turn_id }
    const base = { kind: "ok" as const, thread_id: resolved.entry.thread_id, delivery, message_seq: result.message_seq, deduplicated: false }
    return resolvedBy === undefined ? base : { kind: "ok", thread: summary(session), resolved_by: resolvedBy, delivery, message_seq: result.message_seq, deduplicated: false }
  }
}

export function registerThreadTools(pi: { registerTool(tool: Record<string, unknown>): void }, options: ThreadToolSurfaceOptions): void {
  for (const tool of createThreadTools(options)) pi.registerTool({ ...tool })
}

