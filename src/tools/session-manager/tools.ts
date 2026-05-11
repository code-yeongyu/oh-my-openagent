import type { PluginInput } from "@opencode-ai/plugin"
import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import {
  SESSION_LIST_DESCRIPTION,
  SESSION_READ_DESCRIPTION,
  SESSION_SEARCH_DESCRIPTION,
  SESSION_INFO_DESCRIPTION,
} from "./constants"
import { getAllSessions, getMainSessions, getSessionInfo, readSessionMessages, readSessionTodos, sessionExists, setStorageClient } from "./storage"
import { resolveSessionIdentifier } from "../../features/session-alias"
import {
  filterSessionsByDate,
  formatSessionInfo,
  formatSessionList,
  formatSessionMessages,
  formatSearchResults,
  searchInSession,
} from "./session-formatter"
import type { SessionListArgs, SessionReadArgs, SessionSearchArgs, SessionInfoArgs, SearchResult } from "./types"

const SEARCH_TIMEOUT_MS = 60_000
const MAX_SESSIONS_TO_SCAN = 50

function withTimeout<T>(promise: Promise<T>, ms: number, operation: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${operation} timed out after ${ms}ms`)), ms)),
  ])
}

type SessionManagerToolDeps = {
  getAllSessions: typeof getAllSessions
  getMainSessions: typeof getMainSessions
  getSessionInfo: typeof getSessionInfo
  readSessionMessages: typeof readSessionMessages
  readSessionTodos: typeof readSessionTodos
  sessionExists: typeof sessionExists
  setStorageClient: typeof setStorageClient
  filterSessionsByDate: typeof filterSessionsByDate
  formatSessionInfo: typeof formatSessionInfo
  formatSessionList: typeof formatSessionList
  formatSessionMessages: typeof formatSessionMessages
  formatSearchResults: typeof formatSearchResults
  searchInSession: typeof searchInSession
}

const defaultSessionManagerToolDeps: SessionManagerToolDeps = {
  getAllSessions,
  getMainSessions,
  getSessionInfo,
  readSessionMessages,
  readSessionTodos,
  sessionExists,
  setStorageClient,
  filterSessionsByDate,
  formatSessionInfo,
  formatSessionList,
  formatSessionMessages,
  formatSearchResults,
  searchInSession,
}

export function createSessionManagerTools(
  ctx: PluginInput,
  deps: Partial<SessionManagerToolDeps> = {},
): Record<string, ToolDefinition> {
  const resolvedDeps: SessionManagerToolDeps = {
    ...defaultSessionManagerToolDeps,
    ...deps,
  }
  // Initialize storage client for SDK-based operations (beta mode)
  resolvedDeps.setStorageClient(ctx.client)

  const session_list: ToolDefinition = tool({
    description: SESSION_LIST_DESCRIPTION,
    args: {
      limit: tool.schema.number().optional().describe("Maximum number of sessions to return"),
      from_date: tool.schema.string().optional().describe("Filter sessions from this date (ISO 8601 format)"),
      to_date: tool.schema.string().optional().describe("Filter sessions until this date (ISO 8601 format)"),
      project_path: tool.schema.string().optional().describe("Filter sessions by project path (default: current working directory)"),
    },
    execute: async (args: SessionListArgs, _context) => {
      try {
        const directory = args.project_path ?? ctx.directory
        const sessions = await resolvedDeps.getMainSessions({ directory })
        let sessionIDs = sessions.map((s) => s.id)

        if (args.from_date || args.to_date) {
          sessionIDs = await resolvedDeps.filterSessionsByDate(sessionIDs, args.from_date, args.to_date)
        }

        if (args.limit && args.limit > 0) {
          sessionIDs = sessionIDs.slice(0, args.limit)
        }

        return await resolvedDeps.formatSessionList(sessionIDs)
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`
      }
    },
  })

  const session_read: ToolDefinition = tool({
    description: SESSION_READ_DESCRIPTION,
    args: {
      session_id: tool.schema.string().describe("Session ID to read"),
      include_todos: tool.schema.boolean().optional().describe("Include todo list if available (default: false)"),
      include_transcript: tool.schema.boolean().optional().describe("Include transcript log if available (default: false)"),
      limit: tool.schema.number().optional().describe("Maximum number of messages to return (default: all)"),
    },
    execute: async (args: SessionReadArgs, _context) => {
      try {
        const resolved = resolveSessionIdentifier(args.session_id, { directory: ctx.directory })
        const sessionId = resolved.session_id
        if (!(await resolvedDeps.sessionExists(sessionId))) {
          return resolved.resolved_from_alias
            ? `Session not found: ${sessionId} (resolved from alias \`${resolved.alias}\`)`
            : `Session not found: ${sessionId}`
        }

        let messages = await resolvedDeps.readSessionMessages(sessionId)

        if (messages.length === 0) {
          return resolved.resolved_from_alias
            ? `Session not found: ${sessionId} (resolved from alias \`${resolved.alias}\`)`
            : `Session not found: ${sessionId}`
        }

        if (args.limit && args.limit > 0) {
          messages = messages.slice(0, args.limit)
        }

        const todos = args.include_todos ? await resolvedDeps.readSessionTodos(sessionId) : undefined

        const formatted = resolvedDeps.formatSessionMessages(messages, args.include_todos, todos)
        return resolved.resolved_from_alias
          ? `(alias \`${resolved.alias}\` → \`${sessionId}\`)\n\n${formatted}`
          : formatted
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`
      }
    },
  })

  const session_search: ToolDefinition = tool({
    description: SESSION_SEARCH_DESCRIPTION,
    args: {
      query: tool.schema.string().describe("Search query string"),
      session_id: tool.schema.string().optional().describe("Search within specific session only (default: all sessions)"),
      case_sensitive: tool.schema.boolean().optional().describe("Case-sensitive search (default: false)"),
      limit: tool.schema.number().optional().describe("Maximum number of results to return (default: 20)"),
    },
    execute: async (args: SessionSearchArgs, _context) => {
      try {
        const resultLimit = args.limit && args.limit > 0 ? args.limit : 20

        const searchOperation = async (): Promise<SearchResult[]> => {
          if (args.session_id) {
            const resolved = resolveSessionIdentifier(args.session_id, { directory: ctx.directory })
            return resolvedDeps.searchInSession(resolved.session_id, args.query, args.case_sensitive, resultLimit)
          }

          const allSessions = await resolvedDeps.getAllSessions()
          const sessionsToScan = allSessions.slice(0, MAX_SESSIONS_TO_SCAN)

          const allResults: SearchResult[] = []
          for (const sid of sessionsToScan) {
            if (allResults.length >= resultLimit) break

            const remaining = resultLimit - allResults.length
            const sessionResults = await resolvedDeps.searchInSession(sid, args.query, args.case_sensitive, remaining)
            allResults.push(...sessionResults)
          }

          return allResults.slice(0, resultLimit)
        }

        const results = await withTimeout(searchOperation(), SEARCH_TIMEOUT_MS, "Search")

        return resolvedDeps.formatSearchResults(results)
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`
      }
    },
  })

  const session_info: ToolDefinition = tool({
    description: SESSION_INFO_DESCRIPTION,
    args: {
      session_id: tool.schema.string().describe("Session ID to inspect"),
    },
    execute: async (args: SessionInfoArgs, _context) => {
      try {
        const resolved = resolveSessionIdentifier(args.session_id, { directory: ctx.directory })
        const info = await resolvedDeps.getSessionInfo(resolved.session_id)

        if (!info) {
          return resolved.resolved_from_alias
            ? `Session not found: ${resolved.session_id} (resolved from alias \`${resolved.alias}\`)`
            : `Session not found: ${resolved.session_id}`
        }

        const formatted = resolvedDeps.formatSessionInfo(info)
        return resolved.resolved_from_alias
          ? `(alias \`${resolved.alias}\` → \`${resolved.session_id}\`)\n\n${formatted}`
          : formatted
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`
      }
    },
  })

  return { session_list, session_read, session_search, session_info }
}
