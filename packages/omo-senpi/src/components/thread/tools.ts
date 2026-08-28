import type { AgentToolResult, ToolDefinition } from "@code-yeongyu/senpi"
import { type Static } from "typebox"
import { assembleAddressBook, toThreadAddressEntries, type AddressBookHost, type DiskSession } from "./address-book"
import { fuzzyMatch, resolveTarget, type ThreadAddressEntry } from "./addressing"
import {
  parseThreadParams,
  threadToolParamSchemas,
  type ThreadCreateInput,
  type ThreadHandoffInput,
  type ThreadInterruptInput,
  type ThreadListInput,
  type ThreadReadInput,
  type ThreadSendInput,
  type ThreadToolName,
  type ThreadToolResult,
} from "./contracts"
import { threadToolFailure, type ThreadErrorCode } from "./errors"
import { createOrderedDeliveryMailbox, type MailboxTargetPort } from "./mailbox"
import { THREAD_FAMILY_PROMPT_GUIDELINES, THREAD_TOOL_SEARCH_METADATA } from "./metadata"
import { readTranscript, type ThreadTranscriptEntry } from "./reader"
export type { ThreadTranscriptEntry } from "./reader"
import { createReceiptStore, type ReceiptStore } from "./receipts"

export type ThreadHostSession = {
  readonly sessionId: string
  readonly durableSessionId?: string
  readonly sessionPath?: string
  readonly cwd: string
  readonly name?: string
  readonly status?: "opening" | "open" | "closing" | "closed"
  readonly createdAt?: string
  readonly updatedAt?: string
}

/** The already-running senpi multi-session host, expressed as its public command surface. */
export type ThreadHost = {
  readonly socket: string
  readonly listSessions: () => Promise<readonly ThreadHostSession[]>
  readonly openSession: (params: { readonly cwd?: string; readonly sessionPath?: string; readonly name?: string; readonly forkFrom?: string }) => Promise<ThreadHostSession>
  readonly getMessages: (sessionId: string) => Promise<readonly ThreadTranscriptEntry[]>
  readonly getState: (sessionId: string) => Promise<{ readonly isStreaming?: boolean; readonly activeTurnId?: string }>
  readonly prompt: (sessionId: string, message: string, options?: { readonly streamingBehavior?: "steer" | "followUp" }) => Promise<{ readonly turnId?: string }>
  readonly interrupt: (sessionId: string, turnId?: string) => Promise<{ readonly interrupted?: boolean; readonly turnId?: string }>
}

export type ThreadToolSurfaceOptions = {
  readonly host: ThreadHost
  readonly callerSessionId: () => string
  readonly callerWorkspaceRoot: () => string
  readonly stateDirectory: string
  readonly diskSessions?: () => readonly DiskSession[]
  readonly ensureHost?: () => Promise<void>
}

type AnyTool = ToolDefinition<any, any>
type ToolOutput = AgentToolResult<{ readonly result: ThreadToolResult }>

function failure(code: ThreadErrorCode, message: string, next: string): ThreadToolResult {
  return { kind: "error", error: threadToolFailure(code, message, next) } as ThreadToolResult
}

function output(result: ThreadToolResult): ToolOutput {
  return { content: [{ type: "text", text: JSON.stringify(result) }], details: { result } }
}

type ThreadToolSummary = Omit<ThreadHostSession, "name" | "status" | "createdAt" | "updatedAt"> & {
  readonly thread_id: string
  readonly name: string
  readonly status: "live" | "resumable"
  readonly created_at: string
  readonly updated_at: string
}

type ThreadToolMetadata = {
  readonly name: string
  readonly label: string
  readonly description: string
  readonly exposure: "search"
  readonly searchText: string
  readonly searchKeywords: readonly string[]
  readonly searchGroup: string
  readonly allowLazyActivation: true
}

function metadata(name: ThreadToolName): ThreadToolMetadata {
  const entry = THREAD_TOOL_SEARCH_METADATA.find((candidate) => candidate.name === name)
  if (entry === undefined) throw new Error(`missing thread metadata for ${name}`)
  return {
    name: entry.name, label: entry.label, description: entry.description,
    exposure: entry.exposure, searchText: entry.searchText, searchKeywords: entry.searchKeywords,
    searchGroup: entry.group, allowLazyActivation: entry.allowLazyActivation,
  }
}

function summary(session: ThreadHostSession): ThreadToolSummary {
  const id = session.durableSessionId ?? session.sessionId
  const created = session.createdAt ?? new Date(0).toISOString()
  return {
    ...session,
    thread_id: id,
    name: session.name ?? id,
    status: session.status === "closed" ? "resumable" : "live",
    created_at: created,
    updated_at: session.updatedAt ?? created,
  }
}

function resolveEntries(options: ThreadToolSurfaceOptions, sessions: readonly ThreadHostSession[]): ThreadAddressEntry[] {
  return toThreadAddressEntries(assembleAddressBook([{ socket: options.host.socket, list_sessions: { sessions } } as AddressBookHost], options.diskSessions?.() ?? []))
}

function resolution(options: ThreadToolSurfaceOptions, entries: readonly ThreadAddressEntry[], target: string, allScope?: boolean) {
  return resolveTarget(entries, target, { all_scope: allScope, callerWorkspaceRoot: options.callerWorkspaceRoot() })
}

function routingId(session: ThreadHostSession): string { return session.sessionId }

function targetSession(sessions: readonly ThreadHostSession[], durableId: string): ThreadHostSession | undefined {
  return sessions.find((session) => (session.durableSessionId ?? session.sessionId) === durableId)
}

function makeReceipts(options: ThreadToolSurfaceOptions): ReceiptStore { return createReceiptStore({ directory: options.stateDirectory }) }

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
  async function execute<T extends ThreadToolName>(name: T, callId: string, args: unknown, sideEffect: (sessions: readonly ThreadHostSession[], value: Static<(typeof threadToolParamSchemas)[T]>, operationId: string) => Promise<ThreadToolResult>): Promise<ToolOutput> {
    const parsed = parseThreadParams(threadToolParamSchemas[name], args)
    if (parsed.kind === "error") return output(parsed as ThreadToolResult)
    const value = parsed.value as Static<(typeof threadToolParamSchemas)[T]>
    const admission = receipts.begin({ caller_session_id: options.callerSessionId(), tool: name, args: value, idempotency_key: "idempotency_key" in value ? (value as { idempotency_key?: string }).idempotency_key : undefined, tool_call_id: callId })
    if (admission.kind === "replay") return output(admission.result as ThreadToolResult)
    if (admission.kind === "conflict") return output(failure("idempotency_conflict", "The idempotency key was already used with different arguments.", "Retry with a new idempotency_key."))
    if (admission.kind === "in_progress") return output(failure("idempotency_in_progress", "The same operation is already in progress.", "Wait for the earlier call to settle, then retry."))
    if (admission.kind === "uncertain") return output(failure("idempotency_uncertain", "The earlier operation may have been delivered.", "Read the target transcript before deciding whether to retry."))
    try {
      const result = await sideEffect(await sessions(), value, admission.operation_id)
      receipts.complete(admission, result)
      return output(result)
    } catch (error) {
      receipts.abandon(admission, error instanceof Error ? error.message : String(error))
      return output(failure("internal_error", `Thread operation failed: ${error instanceof Error ? error.message : String(error)}`, "Call thread_list and retry after checking the target."))
    }
  }

  const create: AnyTool = { ...metadata("thread_create"), parameters: threadToolParamSchemas.thread_create, promptGuidelines: [THREAD_FAMILY_PROMPT_GUIDELINES], execute: (id: string, args: ThreadCreateInput) => execute("thread_create", id, args, async (current, value) => {
    const entries = resolveEntries(options, current)
    if (value.name !== undefined) { const existing = entries.find((entry) => entry.name.toLowerCase() === value.name?.trim().toLowerCase()); if (existing !== undefined) return failure("name_conflict", `A thread named "${existing.name}" already exists.`, "Call thread_list and choose another name.") }
    const session = await options.host.openSession({ cwd: value.cwd, forkFrom: value.fork_from, name: value.name })
    return { kind: "ok", thread: summary(session), deduplicated: false }
  }) }
  const list: AnyTool = {
    ...metadata("thread_list"),
    parameters: threadToolParamSchemas.thread_list,
    execute: async (_id: string, args: ThreadListInput) => {
      const current = await sessions()
      const entries = resolveEntries(options, current)
      const visible = args.all_scope === true
        ? current
        : current.filter((session) => entries.some((entry) => entry.thread_id === (session.durableSessionId ?? session.sessionId)))
      return output({ kind: "ok", threads: visible.map(summary), scope: args.all_scope === true ? "all" : "workspace" })
    },
  }
  const read: AnyTool = { ...metadata("thread_read"), parameters: threadToolParamSchemas.thread_read, execute: (id: string, args: ThreadReadInput) => execute("thread_read", id, args, async (current, value) => { const resolved = resolution(options, resolveEntries(options, current), value.thread, value.all_scope); if (resolved.kind === "error") return { kind: "error", error: resolved } as ThreadToolResult; const session = targetSession(current, resolved.entry.thread_id); if (session === undefined) return failure("not_resumable", "The thread has no live owner.", "Retry when the target is live."); const messages = await options.host.getMessages(routingId(session)); const live = readTranscript({ kind: "live", entries: () => messages }, { mode: "tail", max_bytes: value.max_bytes, cursor: value.cursor }); if (live.kind === "error") return { kind: "error", error: live.error }; return { kind: "ok", thread_id: resolved.entry.thread_id, items: live.items.map((item, index) => ({ seq: index + 1, role: item.role === "user" || item.role === "assistant" || item.role === "system" ? item.role : "system", content: JSON.stringify(item.content ?? item) })), truncated: live.truncated, ...(live.next_cursor === null ? {} : { next_cursor: live.next_cursor }), source: live.source } }) }
  const send: AnyTool = { ...metadata("thread_send"), parameters: threadToolParamSchemas.thread_send, execute: (id: string, args: ThreadSendInput) => execute("thread_send", id, args, async (current, value, operationId) => deliver(current, value.thread, value, operationId)) }
  const interrupt: AnyTool = { ...metadata("thread_interrupt"), parameters: threadToolParamSchemas.thread_interrupt, execute: (id: string, args: ThreadInterruptInput) => execute("thread_interrupt", id, args, async (current, value) => { const resolved = resolution(options, resolveEntries(options, current), value.thread, value.all_scope); if (resolved.kind === "error") return { kind: "error", error: resolved } as ThreadToolResult; const session = targetSession(current, resolved.entry.thread_id); if (session === undefined) return failure("not_resumable", "The thread has no live owner.", "Retry when the target is live."); const result = await options.host.interrupt(session.sessionId, value.turn_id); return { kind: "ok", thread_id: resolved.entry.thread_id, ...(result.turnId === undefined ? {} : { turn_id: result.turnId }), interrupted: result.interrupted === true } }) }
  const handoff: AnyTool = { ...metadata("thread_handoff"), parameters: threadToolParamSchemas.thread_handoff, execute: (id: string, args: ThreadHandoffInput) => execute("thread_handoff", id, args, async (current, value, operationId) => { const entries = resolveEntries(options, current); const resolved = value.match === "fuzzy" ? fuzzyMatch(entries, value.thread) : resolveTarget(entries, value.thread, { all_scope: value.all_scope, callerWorkspaceRoot: options.callerWorkspaceRoot() }); if (resolved.kind === "error") return { kind: "error", error: resolved } as ThreadToolResult; return deliver(current, resolved.entry.thread_id, value, operationId, value.match === "fuzzy" ? "fuzzy" : "exact_name") }) }
  return [create, list, read, send, interrupt, handoff]

  async function deliver(current: readonly ThreadHostSession[], address: string, value: ThreadSendInput | ThreadHandoffInput, operationId: string, resolvedBy?: "exact_name" | "fuzzy"): Promise<ThreadToolResult> {
    const resolved = resolution(options, resolveEntries(options, current), address, value.all_scope)
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
