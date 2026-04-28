import { join } from "node:path"
import { getClaudeConfigDir } from "../../shared"

export { OPENCODE_STORAGE, MESSAGE_STORAGE, PART_STORAGE, SESSION_STORAGE } from "../../shared"
export const TODO_DIR = join(getClaudeConfigDir(), "todos")
export const TRANSCRIPT_DIR = join(getClaudeConfigDir(), "transcripts")
export const SESSION_LIST_DESCRIPTION = "List OpenCode sessions with optional date/project filtering. Returns session IDs, message counts, date ranges, and agents."

export const SESSION_READ_DESCRIPTION = "Read a session's messages and history. Optionally include todo list and transcript."

export const SESSION_SEARCH_DESCRIPTION = "Full-text search across session messages. Returns matching excerpts with context."

export const SESSION_INFO_DESCRIPTION = "Get metadata and statistics about a session: message count, date range, agents used, todos, transcript status."

export const SESSION_DELETE_DESCRIPTION = "Delete an OpenCode session and all associated data (messages, parts, todos, transcript). WARNING: This cannot be undone."

export const TOOL_NAME_PREFIX = "session_"
