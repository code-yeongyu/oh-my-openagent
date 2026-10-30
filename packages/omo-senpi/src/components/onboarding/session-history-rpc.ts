import { randomUUID } from "node:crypto"

import type { SenpiExtensionAPI } from "../../extension/types"
import type {
  AgentHome,
  AgentSessionSource,
  CompletedTranscript,
  ImportedProject,
  RecentSessionOutcome,
  SessionHistoryOptions,
  SessionHistoryScanner,
} from "./session-history"
import { loadSessionHistoryRuntime, type SessionHistoryRuntimeLoader } from "./session-history-runtime-loader"

/** Unary: answers the engine's project scan for the homes and projects the desktop names. */
export const OMO_SESSION_PROJECTS_RPC_METHOD = "omo.onboarding.projects"
/** Answers `{ scanId }`, then pushes one {@link OMO_SESSION_THREADS_RPC_EVENT} per outcome, ending with done or failed. */
export const OMO_SESSION_THREADS_RPC_METHOD = "omo.onboarding.sessions"
export const OMO_SESSION_THREADS_RPC_EVENT = "omo.onboarding.sessions.event"

export interface SessionHistoryRpcOptions {
  /** Test seam; production builds the scanner from the lazily loaded session-history runtime. */
  readonly createScanner?: (options: SessionHistoryOptions) => SessionHistoryScanner
  readonly loadRuntime?: SessionHistoryRuntimeLoader
  readonly newScanId?: () => string
}

type Unavailable = { readonly kind: "unavailable"; readonly reason: string }
type Parsed<T> = { readonly value: T } | Unavailable

interface OwnDirectories {
  readonly excludedDirectories: ReadonlyArray<string>
  readonly managedWorktreeDirectories: ReadonlyArray<string>
}

/**
 * The desktop's thread import reads the engine's session history through these two methods (#3080), so
 * discovery and transcript parsing exist once, here. Both are read-only filesystem work: no model, no session.
 */
export function registerSessionHistoryRpc(pi: SenpiExtensionAPI, options: SessionHistoryRpcOptions = {}): void {
  const rpc = pi.rpc
  const handle = rpc?.handle
  if (rpc === undefined || handle === undefined) return
  const loadRuntime = options.loadRuntime ?? loadSessionHistoryRuntime
  const createScanner = async (scanOptions: SessionHistoryOptions): Promise<SessionHistoryScanner> =>
    options.createScanner?.(scanOptions) ?? (await loadRuntime()).createSessionHistoryScanner(scanOptions)
  const newScanId = options.newScanId ?? randomUUID

  handle(OMO_SESSION_PROJECTS_RPC_METHOD, async (data) => {
    const request = parseProjectsRequest(data)
    if (!("value" in request)) return request
    try {
      return await (await createScanner(request.value)).scanProjects()
    } catch (cause) {
      return unavailable(reasonOf(cause))
    }
  })

  handle(OMO_SESSION_THREADS_RPC_METHOD, (data) => {
    const request = parseSessionsRequest(data)
    if (!("value" in request)) return request
    const { workspaceRoot, completed, homes, excludedDirectories, managedWorktreeDirectories } = request.value
    const scanId = newScanId()
    const emit = (event: Record<string, unknown>) => rpc.emit(OMO_SESSION_THREADS_RPC_EVENT, { scanId, ...event })
    // The host writes the reply when this handler settles; starting on the next macrotask keeps it ahead of every event.
    setImmediate(async () => {
      try {
        const scanner = await createScanner({ homes, excludedDirectories, managedWorktreeDirectories })
        const run = scanner.recentSessions({ workspaceRoot, completed })
        for await (const outcome of run) emit({ kind: "outcome", outcome: wireOutcome(outcome) })
        emit({ kind: "done" })
      } catch (cause) {
        emit({ kind: "failed", reason: reasonOf(cause) })
      }
    })
    return { scanId }
  })
}

function wireOutcome(outcome: RecentSessionOutcome) {
  return outcome._tag === "Importable" ? { _tag: outcome._tag, thread: outcome.thread, source: outcome.source } : outcome
}

function parseProjectsRequest(data: unknown): Parsed<OwnDirectories & { homes: Array<AgentHome>; importedProjects: Array<ImportedProject> }> {
  if (!isRecord(data)) return unavailable("Request must be an object.")
  const homes = parseHomes(data.homes)
  const importedProjects = parseList(data.importedProjects, (entry) =>
    isRecord(entry) && typeof entry.id === "string" && typeof entry.workspaceRoot === "string"
      ? { id: entry.id, workspaceRoot: entry.workspaceRoot }
      : undefined)
  const own = parseOwnDirectories(data)
  if (homes === undefined) return unavailable("homes must list {source, homePath} with a claudeAgent or codex source.")
  if (importedProjects === undefined) return unavailable("importedProjects must list {id, workspaceRoot}.")
  if (own === undefined) return unavailable("excludedDirectories and managedWorktreeDirectories must be string lists.")
  return { value: { homes, importedProjects, ...own } }
}

function parseSessionsRequest(data: unknown): Parsed<OwnDirectories & { workspaceRoot: string; homes: Array<AgentHome>; completed: Array<CompletedTranscript> }> {
  if (!isRecord(data)) return unavailable("Request must be an object.")
  const homes = parseHomes(data.homes)
  const completed = parseList(data.completed, parseCompleted)
  const own = parseOwnDirectories(data)
  if (typeof data.workspaceRoot !== "string" || data.workspaceRoot.length === 0) return unavailable("workspaceRoot must be a non-empty string.")
  if (homes === undefined) return unavailable("homes must list {source, homePath} with a claudeAgent or codex source.")
  if (completed === undefined) return unavailable("completed must list transcript identities.")
  if (own === undefined) return unavailable("excludedDirectories and managedWorktreeDirectories must be string lists.")
  return { value: { workspaceRoot: data.workspaceRoot, homes, completed, ...own } }
}

function parseHomes(value: unknown): Array<AgentHome> | undefined {
  return parseList(value, (entry) =>
    isRecord(entry) && isSource(entry.source) && typeof entry.homePath === "string"
      ? { source: entry.source, homePath: entry.homePath }
      : undefined)
}

function parseCompleted(entry: unknown): CompletedTranscript | undefined {
  if (!isRecord(entry) || !isSource(entry.provider)) return undefined
  const { providerSessionId, filePath, size, mtimeMs, device, inode, birthtimeMs } = entry
  if (typeof providerSessionId !== "string" || typeof filePath !== "string") return undefined
  if (typeof size !== "number" || typeof device !== "number") return undefined
  if (!isNumberOrNull(mtimeMs) || !isNumberOrNull(inode) || !isNumberOrNull(birthtimeMs)) return undefined
  return { provider: entry.provider, providerSessionId, filePath, size, mtimeMs, device, inode, birthtimeMs }
}

function parseOwnDirectories(data: Record<string, unknown>): OwnDirectories | undefined {
  const excludedDirectories = parseList(data.excludedDirectories, (entry) => typeof entry === "string" ? entry : undefined)
  const managedWorktreeDirectories = parseList(data.managedWorktreeDirectories, (entry) => typeof entry === "string" ? entry : undefined)
  if (excludedDirectories === undefined || managedWorktreeDirectories === undefined) return undefined
  return { excludedDirectories, managedWorktreeDirectories }
}

function parseList<T>(value: unknown, parse: (entry: unknown) => T | undefined): Array<T> | undefined {
  if (!Array.isArray(value)) return undefined
  const parsed: Array<T> = []
  for (const entry of value) {
    const item = parse(entry)
    if (item === undefined) return undefined
    parsed.push(item)
  }
  return parsed
}

const isSource = (value: unknown): value is AgentSessionSource => value === "claudeAgent" || value === "codex"
const isNumberOrNull = (value: unknown): value is number | null => value === null || typeof value === "number"
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null
const unavailable = (reason: string): Unavailable => ({ kind: "unavailable", reason })
const reasonOf = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause)
