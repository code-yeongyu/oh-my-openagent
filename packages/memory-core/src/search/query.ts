// FTS-lite query parsing and scoring.
//
// Exact port of letta-code src/backend/local/transcript-search.ts:167-292
// (searchableText, parseQuery, matchScore, dateInRange). The scoring formula is
// intentionally reproduced verbatim so local search ranking stays letta-identical:
//
//   score = sum over terms(first-match index + max(0, 50 - term.length))
//         + sum over phrases(0.1 * first-match index)
//
// Every term AND every phrase must substring-match the normalized haystack, or
// the document does not match at all.

/** Harness-neutral message projection consumed by the search engine. */
export interface SearchDocument {
  id: string
  conversationId: string
  /** ISO timestamp; missing or unparseable dates stay eligible for date filters. */
  date?: string
  /** letta message_type equivalent (senpi: the message role). */
  messageType?: string
  /** Plain string, or content parts carrying a `text` field. */
  content?: unknown
  reasoning?: string
  summary?: string
  toolCalls?: readonly { name?: string; arguments?: string }[]
  toolReturn?: unknown
  funcResponse?: unknown
}

export interface ParsedQuery {
  terms: string[]
  phrases: string[]
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((part) => {
      if (part && typeof part === "object" && "text" in part) {
        const { text } = part as { text?: unknown }
        return typeof text === "string" ? text : ""
      }
      return ""
    })
    .filter(Boolean)
    .join("\n")
}

function stringifySearchValue(value: unknown): string {
  if (typeof value === "string") return value
  if (value === null || value === undefined) return ""
  try {
    return JSON.stringify(value) ?? ""
  } catch {
    return String(value)
  }
}

/** Composes the searchable haystack: type + content + reasoning + summary + tool names/args + returns. */
export function searchableText(document: SearchDocument): string {
  const toolCalls = document.toolCalls ?? []
  return [
    document.messageType,
    textFromContent(document.content),
    document.reasoning,
    document.summary,
    ...toolCalls.flatMap((call) => [call.name, call.arguments]),
    stringifySearchValue(document.toolReturn),
    stringifySearchValue(document.funcResponse),
  ]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join("\n")
}

export function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim()
}

/**
 * Splits a query into bare terms and double-quoted phrases. An unclosed quote
 * discards the parse and falls back to raw whitespace-split terms, which keeps
 * the dangling quote character inside its term (letta behaviour).
 */
export function parseQuery(query: string): ParsedQuery {
  const terms: string[] = []
  const phrases: string[] = []
  let buffer = ""
  let inQuote = false
  let sawUnclosedQuote = false

  const flush = () => {
    const value = buffer.trim()
    buffer = ""
    if (!value) return
    if (inQuote) phrases.push(value)
    else terms.push(value)
  }

  for (const char of query.trim()) {
    if (char === '"') {
      flush()
      inQuote = !inQuote
      continue
    }
    if (!inQuote && /\s/.test(char)) {
      flush()
      continue
    }
    buffer += char
  }
  if (inQuote) sawUnclosedQuote = true
  flush()

  if (sawUnclosedQuote) {
    return {
      terms: query
        .trim()
        .split(/\s+/)
        .map((term) => term.trim())
        .filter(Boolean),
      phrases: [],
    }
  }
  return { terms, phrases }
}

/** Returns the letta score, or null when any term or phrase is absent. */
export function matchScore(text: string, query: ParsedQuery): number | null {
  const haystack = normalizeText(text)
  if (!haystack) return null

  let score = 0
  for (const rawPhrase of query.phrases) {
    const phrase = normalizeText(rawPhrase)
    if (!phrase) continue
    const index = haystack.indexOf(phrase)
    if (index < 0) return null
    score += index * 0.1
  }

  for (const rawTerm of query.terms) {
    const term = normalizeText(rawTerm)
    if (!term) continue
    const index = haystack.indexOf(term)
    if (index < 0) return null
    score += index + Math.max(0, 50 - term.length)
  }

  return score
}

/** Inclusive ISO range filter; missing or unparseable dates keep a message eligible. */
export function dateInRange(
  createdAt: string | undefined,
  startDate: string | undefined,
  endDate: string | undefined,
): boolean {
  if (!startDate && !endDate) return true
  if (!createdAt) return true
  const messageTime = Date.parse(createdAt)
  if (!Number.isFinite(messageTime)) return true

  const startTime = startDate ? Date.parse(startDate) : Number.NEGATIVE_INFINITY
  const endTime = endDate ? Date.parse(endDate) : Number.POSITIVE_INFINITY
  if (startDate && !Number.isFinite(startTime)) return true
  if (endDate && !Number.isFinite(endTime)) return true

  return messageTime >= startTime && messageTime <= endTime
}
