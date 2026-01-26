import type { SessionInfo, SessionMessage, SearchResult, SessionMetadata } from "./types"
import { getSessionInfo, readSessionMessages } from "./storage"

export async function formatSessionList(sessions: SessionMetadata[]): Promise<string> {
  if (sessions.length === 0) {
    return "No sessions found."
  }

  interface EnrichedInfo extends SessionInfo {
    preview?: string
    files?: number
    additions?: number
    deletions?: number
  }

  const infos: EnrichedInfo[] = []
  for (const meta of sessions) {
    const info = await getSessionInfo(meta.id)
    if (info) {
      const enriched: EnrichedInfo = {
        ...info,
        title: meta.title,
        preview: meta.preview,
        files: meta.summary?.files,
        additions: meta.summary?.additions,
        deletions: meta.summary?.deletions,
      }
      infos.push(enriched)
    }
  }

  if (infos.length === 0) {
    return "No valid sessions found."
  }

  const formatDateTime = (date: Date | undefined): string => {
    if (!date) return "N/A"
    const d = date.toISOString().split("T")
    const time = d[1].substring(0, 5)
    return `${d[0]} ${time}`
  }

  const formatChanges = (info: EnrichedInfo): string => {
    if (info.files === undefined) return "-"
    const parts: string[] = []
    if (info.files > 0) parts.push(`${info.files}F`)
    if (info.additions && info.additions > 0) parts.push(`+${info.additions}`)
    if (info.deletions && info.deletions > 0) parts.push(`-${info.deletions}`)
    return parts.length > 0 ? parts.join("/") : "-"
  }

  const getDisplayTitle = (info: EnrichedInfo): string => {
    if (info.title && info.title.trim()) return truncate(info.title, 30)
    if (info.preview) return truncate(info.preview, 30)
    return "(untitled)"
  }

  const truncate = (str: string, maxLen: number): string => {
    if (str.length <= maxLen) return str
    return str.substring(0, maxLen - 3) + "..."
  }

  const headers = ["Session ID", "Title/Preview", "Msgs", "Updated", "Changes", "Agents"]
  const rows = infos.map((info) => [
    info.id,
    getDisplayTitle(info),
    info.message_count.toString(),
    formatDateTime(info.last_message),
    formatChanges(info),
    truncate(info.agents_used.join(", ") || "none", 20),
  ])

  const colWidths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)))

  const formatRow = (cells: string[]): string => {
    return (
      "| " +
      cells
        .map((cell, i) => cell.padEnd(colWidths[i]))
        .join(" | ")
        .trim() +
      " |"
    )
  }

  const separator = "|" + colWidths.map((w) => "-".repeat(w + 2)).join("|") + "|"

  return [formatRow(headers), separator, ...rows.map(formatRow)].join("\n")
}

export function formatSessionMessages(
  messages: SessionMessage[],
  includeTodos?: boolean,
  todos?: Array<{ id: string; content: string; status: string }>
): string {
  if (messages.length === 0) {
    return "No messages found in this session."
  }

  const lines: string[] = []

  for (const msg of messages) {
    const timestamp = msg.time?.created ? new Date(msg.time.created).toISOString() : "Unknown time"
    const agent = msg.agent ? ` (${msg.agent})` : ""
    lines.push(`\n[${msg.role}${agent}] ${timestamp}`)

    for (const part of msg.parts) {
      if (part.type === "text" && part.text) {
        lines.push(part.text.trim())
      } else if (part.type === "thinking" && part.thinking) {
        lines.push(`[thinking] ${part.thinking.substring(0, 200)}...`)
      } else if ((part.type === "tool_use" || part.type === "tool") && part.tool) {
        const input = part.input ? JSON.stringify(part.input).substring(0, 100) : ""
        lines.push(`[tool: ${part.tool}] ${input}`)
      } else if (part.type === "tool_result") {
        const output = part.output ? part.output.substring(0, 200) : ""
        lines.push(`[tool result] ${output}...`)
      }
    }
  }

  if (includeTodos && todos && todos.length > 0) {
    lines.push("\n\n=== Todos ===")
    for (const todo of todos) {
      const status = todo.status === "completed" ? "[x]" : todo.status === "in_progress" ? "[-]" : "[ ]"
      lines.push(`${status} [${todo.status}] ${todo.content}`)
    }
  }

  return lines.join("\n")
}

export function formatSessionInfo(info: SessionInfo): string {
  const lines = [
    `Session ID: ${info.id}`,
    `Messages: ${info.message_count}`,
    `Date Range: ${info.first_message?.toISOString() ?? "N/A"} to ${info.last_message?.toISOString() ?? "N/A"}`,
    `Agents Used: ${info.agents_used.join(", ") || "none"}`,
    `Has Todos: ${info.has_todos ? `Yes (${info.todos?.length ?? 0} items)` : "No"}`,
    `Has Transcript: ${info.has_transcript ? `Yes (${info.transcript_entries} entries)` : "No"}`,
  ]

  if (info.first_message && info.last_message) {
    const duration = info.last_message.getTime() - info.first_message.getTime()
    const days = Math.floor(duration / (1000 * 60 * 60 * 24))
    const hours = Math.floor((duration % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
    if (days > 0 || hours > 0) {
      lines.push(`Duration: ${days} days, ${hours} hours`)
    }
  }

  return lines.join("\n")
}

export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return "No matches found."
  }

  const lines: string[] = [`Found ${results.length} matches:\n`]

  for (const result of results) {
    const timestamp = result.timestamp ? new Date(result.timestamp).toISOString() : ""
    lines.push(`[${result.session_id}] ${result.message_id} (${result.role}) ${timestamp}`)
    lines.push(`  ${result.excerpt}`)
    lines.push(`  Matches: ${result.match_count}\n`)
  }

  return lines.join("\n")
}

export async function filterSessionsByDate(
  sessionIDs: string[],
  fromDate?: string,
  toDate?: string
): Promise<string[]> {
  if (!fromDate && !toDate) return sessionIDs

  const from = fromDate ? new Date(fromDate) : null
  const to = toDate ? new Date(toDate) : null

  const results: string[] = []
  for (const id of sessionIDs) {
    const info = await getSessionInfo(id)
    if (!info || !info.last_message) continue

    if (from && info.last_message < from) continue
    if (to && info.last_message > to) continue

    results.push(id)
  }

  return results
}

export async function searchInSession(
  sessionID: string,
  query: string,
  caseSensitive = false,
  maxResults?: number
): Promise<SearchResult[]> {
  const messages = await readSessionMessages(sessionID)
  const results: SearchResult[] = []

  const searchQuery = caseSensitive ? query : query.toLowerCase()

  for (const msg of messages) {
    if (maxResults && results.length >= maxResults) break

    let matchCount = 0
    const excerpts: string[] = []

    for (const part of msg.parts) {
      if (part.type === "text" && part.text) {
        const text = caseSensitive ? part.text : part.text.toLowerCase()
        const matches = text.split(searchQuery).length - 1
        if (matches > 0) {
          matchCount += matches

          const index = text.indexOf(searchQuery)
          if (index !== -1) {
            const start = Math.max(0, index - 50)
            const end = Math.min(text.length, index + searchQuery.length + 50)
            let excerpt = part.text.substring(start, end)
            if (start > 0) excerpt = "..." + excerpt
            if (end < text.length) excerpt = excerpt + "..."
            excerpts.push(excerpt)
          }
        }
      }
    }

    if (matchCount > 0) {
      results.push({
        session_id: sessionID,
        message_id: msg.id,
        role: msg.role,
        excerpt: excerpts[0] || "",
        match_count: matchCount,
        timestamp: msg.time?.created,
      })
    }
  }

  return results
}
