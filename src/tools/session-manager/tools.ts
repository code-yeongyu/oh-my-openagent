import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import {
  SESSION_LIST_DESCRIPTION,
  SESSION_READ_DESCRIPTION,
  SESSION_SEARCH_DESCRIPTION,
  SESSION_INFO_DESCRIPTION,
} from "./constants"
import { getAllSessions, getSessionInfo, readSessionMessages, readSessionTodos, sessionExists } from "./storage"
import { filterSessionsByDate, formatSessionInfo, formatSessionList, formatSessionMessages, formatSearchResults, searchInSession } from "./utils"
import type { SessionListArgs, SessionReadArgs, SessionSearchArgs, SessionInfoArgs } from "./types"

export const session_list: ToolDefinition = tool({
  description: SESSION_LIST_DESCRIPTION,
  args: {
    limit: tool.schema.number().optional().describe("Maximum number of sessions to return"),
    from_date: tool.schema.string().optional().describe("Filter sessions from this date (ISO 8601 format)"),
    to_date: tool.schema.string().optional().describe("Filter sessions until this date (ISO 8601 format)"),
  },
  execute: async (args: SessionListArgs, _context) => {
    try {
      let sessions = getAllSessions()

      if (args.from_date || args.to_date) {
        sessions = filterSessionsByDate(sessions, args.from_date, args.to_date)
      }

      if (args.limit && args.limit > 0) {
        sessions = sessions.slice(0, args.limit)
      }

      return formatSessionList(sessions)
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`
    }
  },
})

export const session_read: ToolDefinition = tool({
  description: SESSION_READ_DESCRIPTION,
  args: {
    session_id: tool.schema.string().describe("Session ID to read"),
    include_todos: tool.schema.boolean().optional().describe("Include todo list if available (default: false)"),
    include_transcript: tool.schema.boolean().optional().describe("Include transcript log if available (default: false)"),
    limit: tool.schema.number().optional().describe("Maximum number of messages to return (default: all)"),
  },
  execute: async (args: SessionReadArgs, _context) => {
    try {
      if (!sessionExists(args.session_id)) {
        return `Session not found: ${args.session_id}`
      }

      let messages = readSessionMessages(args.session_id)

      if (args.limit && args.limit > 0) {
        messages = messages.slice(0, args.limit)
      }

      const todos = args.include_todos ? readSessionTodos(args.session_id) : undefined

      return formatSessionMessages(messages, args.include_todos, todos)
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`
    }
  },
})

export const session_search: ToolDefinition = tool({
  description: SESSION_SEARCH_DESCRIPTION,
  args: {
    query: tool.schema.string().describe("Search query string"),
    session_id: tool.schema.string().optional().describe("Search within specific session only (default: all sessions)"),
    case_sensitive: tool.schema.boolean().optional().describe("Case-sensitive search (default: false)"),
    limit: tool.schema.number().optional().describe("Maximum number of results to return (default: 20)"),
  },
  execute: async (args: SessionSearchArgs, _context) => {
    try {
      const sessions = args.session_id ? [args.session_id] : getAllSessions()

      const allResults = sessions.flatMap((sid) => searchInSession(sid, args.query, args.case_sensitive))

      const limited = args.limit && args.limit > 0 ? allResults.slice(0, args.limit) : allResults.slice(0, 20)

      return formatSearchResults(limited)
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`
    }
  },
})

export const session_info: ToolDefinition = tool({
  description: SESSION_INFO_DESCRIPTION,
  args: {
    session_id: tool.schema.string().describe("Session ID to inspect"),
  },
  execute: async (args: SessionInfoArgs, _context) => {
    try {
      const info = getSessionInfo(args.session_id)

      if (!info) {
        return `Session not found: ${args.session_id}`
      }

      return formatSessionInfo(info)
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`
    }
  },
})
