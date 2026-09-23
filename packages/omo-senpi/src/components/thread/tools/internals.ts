import type { AgentToolResult, ToolDefinition } from "@code-yeongyu/senpi"
import { assembleAddressBook, toThreadAddressEntries, type AddressBookHost } from "../address-book"
import { resolveTarget, type ThreadAddressEntry } from "../addressing"
import type { ThreadToolName, ThreadToolResult } from "../contracts"
import { threadToolFailure, type ThreadErrorCode } from "../errors"
import { THREAD_TOOL_SEARCH_METADATA } from "../metadata"
import { createReceiptStore, type ReceiptStore } from "../receipts"
import { UNKNOWN_CALLER, type ThreadHost, type ThreadHostSession, type ThreadToolSurfaceOptions } from "./ports"

// biome-ignore lint/suspicious/noExplicitAny: the tool definitions are heterogeneous by design.
export type AnyTool = ToolDefinition<any, any>
export type ToolOutput = AgentToolResult<{ readonly result: ThreadToolResult }>

export function failure(code: ThreadErrorCode, message: string, next: string, details?: Readonly<Record<string, unknown>>): ThreadToolResult {
  return { kind: "error", error: threadToolFailure(code, message, next, details) }
}

export function output(result: ThreadToolResult): ToolOutput {
  return { content: [{ type: "text", text: JSON.stringify(result) }], details: { result } }
}

export type ThreadToolSummary = Omit<ThreadHostSession, "name" | "status" | "createdAt" | "updatedAt"> & {
  readonly thread_id: string
  readonly name: string
  readonly status: "live" | "resumable"
  readonly created_at: string
  readonly updated_at: string
}

export type ThreadToolMetadata = {
  readonly name: string
  readonly label: string
  readonly description: string
  readonly exposure: "search"
  readonly searchText: string
  readonly searchKeywords: readonly string[]
  readonly searchGroup: string
  readonly allowLazyActivation: true
}

export function metadata(name: ThreadToolName): ThreadToolMetadata {
  const entry = THREAD_TOOL_SEARCH_METADATA.find((candidate) => candidate.name === name)
  if (entry === undefined) throw new Error(`missing thread metadata for ${name}`)
  return {
    name: entry.name, label: entry.label, description: entry.description,
    exposure: entry.exposure, searchText: entry.searchText, searchKeywords: entry.searchKeywords,
    searchGroup: entry.group, allowLazyActivation: entry.allowLazyActivation,
  }
}

export function summary(session: ThreadHostSession): ThreadToolSummary {
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

export function resolveEntries(options: ThreadToolSurfaceOptions, sessions: readonly ThreadHostSession[]): ThreadAddressEntry[] {
  return toThreadAddressEntries(assembleAddressBook([{ socket: options.host.socket, list_sessions: { sessions } } as AddressBookHost], options.diskSessions?.() ?? []))
}

export function resolution(options: ThreadToolSurfaceOptions, entries: readonly ThreadAddressEntry[], target: string, callerId: string, allScope?: boolean) {
  if (target === "self") {
    // UNKNOWN_CALLER stands for an ABSENT identity, so it must never match an entry: a thread
    // that happened to carry it as its durable id would otherwise be renamed or re-modelled by
    // any caller whose host passes no execution context.
    const caller = callerId === UNKNOWN_CALLER ? undefined : entries.find((entry) => entry.thread_id === callerId)
    if (caller === undefined) return { kind: "error" as const, ...threadToolFailure("caller_context_missing", "The caller's durable session id is not in the thread address book.", "Call thread_list and pass an explicit thread_id, or retry from a session with caller context.") }
    target = caller.thread_id
  }
  return resolveTarget(entries, target, { all_scope: allScope, callerWorkspaceRoot: options.callerWorkspaceRoot() })
}

export function routingId(session: ThreadHostSession): string { return session.sessionId }

export function targetSession(sessions: readonly ThreadHostSession[], durableId: string): ThreadHostSession | undefined {
  return sessions.find((session) => (session.durableSessionId ?? session.sessionId) === durableId)
}

export function makeReceipts(options: ThreadToolSurfaceOptions): ReceiptStore { return createReceiptStore({ directory: options.stateDirectory }) }
