import type { PluginInput } from "@opencode-ai/plugin"
import { createOpencodeClient as createGlobalSessionClient } from "@opencode-ai/sdk/v2/client"
import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import {
  SESSION_LIST_DESCRIPTION,
  SESSION_READ_DESCRIPTION,
  SESSION_SEARCH_DESCRIPTION,
  SESSION_INFO_DESCRIPTION,
} from "./constants"
import { getServerBasicAuthHeader } from "../../shared"
import { getAllSessions, getMainSessions, getSessionInfo, readSessionMessages, readSessionTodos, sessionExists, setStorageClient } from "./storage"
import {
  filterSessionsByDate,
  formatSessionInfo,
  formatSessionList,
  formatSessionMessages,
  formatSearchResults,
  searchInSession,
} from "./session-formatter"
import type { SessionListArgs, SessionReadArgs, SessionSearchArgs, SessionInfoArgs, SearchResult } from "./types"
import { describeSessionError, formatSkippedSessions, type SkippedSession } from "./session-error"

const SEARCH_TIMEOUT_MS = 60_000
const MAX_SESSIONS_TO_SCAN = 50

function createGlobalSessionSdkClient(serverUrl: URL | undefined) {
  if (!serverUrl) return undefined

  const authorization = getServerBasicAuthHeader()
  return createGlobalSessionClient({
    baseUrl: serverUrl.toString(),
    ...(authorization ? { headers: { Authorization: authorization } } : {}),
  })
}

// The timeout aborts the operation's signal as well as rejecting, so reads stop instead of running on
// in the background. A caller abort (the tool call being cancelled) stops them the same way.
async function runWithAbortableTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  ms: number,
  name: string,
  callerSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController()
  const signal = callerSignal ? AbortSignal.any([callerSignal, controller.signal]) : controller.signal
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${name} timed out after ${ms}ms`)
      controller.abort(error)
      reject(error)
    }, ms)
  })
  const running = operation(signal)
  // After a timeout the operation still rejects with our own abort reason; the race has already settled.
  running.catch(() => undefined)
  try {
    return await Promise.race([running, timedOut])
  } finally {
    clearTimeout(timer)
  }
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
  // Initialize storage clients for SDK-based operations (beta mode)
  resolvedDeps.setStorageClient(ctx.client, createGlobalSessionSdkClient(ctx.serverUrl))

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
        const limit = !args.from_date && !args.to_date && args.limit && args.limit > 0 ? args.limit : undefined
        let sessions = await resolvedDeps.getMainSessions({ directory, limit })
        let sessionIDs = sessions.map((s) => s.id)

        if (args.from_date || args.to_date) {
          sessionIDs = await resolvedDeps.filterSessionsByDate(sessionIDs, args.from_date, args.to_date, _context.abort)
        }

        if (args.limit && args.limit > 0) {
          sessionIDs = sessionIDs.slice(0, args.limit)
        }

        return await resolvedDeps.formatSessionList(sessionIDs, _context.abort)
      } catch (e) {
        return `Error: ${describeSessionError(e)}`
      }
    },
  })

  const session_read: ToolDefinition = tool({
    description: SESSION_READ_DESCRIPTION,
    args: {
      session_id: tool.schema.string().describe("Session ID to read"),
      include_todos: tool.schema.boolean().optional().describe("Include todo list if available (default: false)"),
      include_transcript: tool.schema.boolean().optional().describe("Include transcript log if available (default: false)"),
      limit: tool.schema.number().optional().describe("Maximum number of messages to return (default: all messages)"),
      from_end: tool.schema.boolean().optional().describe("Read messages from the END of the session (default: false). Pass true to get the most-recent / final assistant message in the output. Recommended when you want the result of a completed task."),
    },
    execute: async (args: SessionReadArgs, _context) => {
      try {
        if (!(await resolvedDeps.sessionExists(args.session_id))) {
          return `Session not found: ${args.session_id}`
        }

        const messages = await resolvedDeps.readSessionMessages(args.session_id, {
          limit: args.limit,
          fromEnd: args.from_end,
          signal: _context.abort,
        })

        if (messages.length === 0) {
          return `Session not found: ${args.session_id}`
        }

        const todos = args.include_todos ? await resolvedDeps.readSessionTodos(args.session_id) : undefined

        return resolvedDeps.formatSessionMessages(messages, args.include_todos, todos)
      } catch (e) {
        return `Error: ${describeSessionError(e)}`
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

        const skipped: SkippedSession[] = []
        const searchOperation = async (signal: AbortSignal): Promise<SearchResult[]> => {
          if (args.session_id) {
            return resolvedDeps.searchInSession(args.session_id, args.query, args.case_sensitive, resultLimit, signal)
          }

          const allSessions = await resolvedDeps.getAllSessions(MAX_SESSIONS_TO_SCAN)
          const sessionsToScan = allSessions.slice(0, MAX_SESSIONS_TO_SCAN)

          const allResults: SearchResult[] = []
          for (const sid of sessionsToScan) {
            signal.throwIfAborted()
            if (allResults.length >= resultLimit) break

            const remaining = resultLimit - allResults.length
            try {
              const sessionResults = await resolvedDeps.searchInSession(sid, args.query, args.case_sensitive, remaining, signal)
              allResults.push(...sessionResults)
            } catch (error) {
              signal.throwIfAborted()
              skipped.push({ id: sid, reason: describeSessionError(error) })
            }
          }

          return allResults.slice(0, resultLimit)
        }

        const results = await runWithAbortableTimeout(searchOperation, SEARCH_TIMEOUT_MS, "Search", _context.abort)

        return resolvedDeps.formatSearchResults(results) + formatSkippedSessions(skipped)
      } catch (e) {
        return `Error: ${describeSessionError(e)}`
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
        const info = await resolvedDeps.getSessionInfo(args.session_id, _context.abort)

        if (!info) {
          return `Session not found: ${args.session_id}`
        }

        return resolvedDeps.formatSessionInfo(info)
      } catch (e) {
        return `Error: ${describeSessionError(e)}`
      }
    },
  })

  return { session_list, session_read, session_search, session_info }
}
