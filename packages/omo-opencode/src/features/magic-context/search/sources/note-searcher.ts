import type { Database } from "../../db/sqlite"
import { getNotes, type Note, type NoteStatus } from "../../db/queries/notes"
import type { SearchQuery, SearchResult, SearchSource } from "../types"

const NOTE_SEARCHABLE_STATUSES: NoteStatus[] = ["active", "pending", "ready", "dismissed"]

export async function searchNote(
  db: Database,
  _queryEmbedding: Float32Array,
  query: SearchQuery,
): Promise<SearchResult[]> {
  if (query.sources && !query.sources.includes("note" as SearchSource)) return []
  if (query.text.trim().length === 0) return []

  const limit = query.limit ?? 10

  const sessionNotes = getNotes(db, {
    sessionId: query.sessionId,
    type: "session",
    status: NOTE_SEARCHABLE_STATUSES,
  })
  const projectNotes = getNotes(db, {
    projectPath: query.projectPath,
    type: "smart",
    status: NOTE_SEARCHABLE_STATUSES,
  })
  const notes = [...sessionNotes, ...projectNotes]
  if (notes.length === 0) return []

  const scored = rankNotesForQuery(notes, query.text.trim())
  return scored.slice(0, limit).map((entry) => ({
    id: `note:${entry.note.id}`,
    source: "note" as const,
    title: `Note #${entry.note.id} (${entry.note.status})`,
    content: previewText(entry.text),
    score: entry.score,
    metadata: {
      noteId: entry.note.id,
      status: entry.note.status,
      createdAt: entry.note.createdAt,
      anchorOrdinal: entry.note.anchorOrdinal,
      sourceSessionId: entry.note.sessionId,
    },
  }))
}

function noteSearchText(note: Pick<Note, "content" | "readyReason">): string {
  const reason = note.readyReason?.trim()
  return reason ? `${note.content}\nReason: ${reason}` : note.content
}

function rankNotesForQuery(
  notes: Note[],
  query: string,
): Array<{ note: Note; text: string; score: number }> {
  const needle = query.toLowerCase()
  const needleTokens = tokenize(needle)
  const ranked: Array<{ note: Note; text: string; score: number }> = []

  for (const note of notes) {
    const text = noteSearchText(note)
    const normalizedText = text.toLowerCase()
    const noteTokens = new Set(tokenize(normalizedText))
    const exact = normalizedText.includes(needle)
    const matchedTokens = needleTokens.filter((t) => noteTokens.has(t)).length

    if (!exact && matchedTokens === 0) continue

    const coverage = needleTokens.length > 0 ? matchedTokens / needleTokens.length : 0
    const score =
      (exact ? 2 : 0) +
      coverage +
      (needleTokens.length > 1 && matchedTokens === needleTokens.length ? 0.5 : 0)

    ranked.push({ note, text, score })
  }

  return ranked.sort((a, b) => b.score - a.score || b.note.createdAt - a.note.createdAt)
}

function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-z0-9/._:-]+/g) ?? []
  const seen = new Set<string>()
  const tokens: string[] = []
  for (const m of matches) {
    if (m.length <= 1 || !/[a-z0-9]/.test(m) || seen.has(m)) continue
    seen.add(m)
    tokens.push(m)
  }
  return tokens
}

const RESULT_PREVIEW_LIMIT = 220

function previewText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim()
  if (normalized.length <= RESULT_PREVIEW_LIMIT) return normalized
  return `${normalized.slice(0, RESULT_PREVIEW_LIMIT - 1).trimEnd()}…`
}
