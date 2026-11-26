import type { ThreadTranscriptEntry } from "../reader"
import { transcriptRole } from "./internals"

const ERROR_TEXT_MAX_CHARS = 500

// #14278: an assistant message a provider error ended carries no content, only its errorMessage; rendering the
// content alone showed a 429 storm as a row of `[]`, so a reader could not tell a rate-limit wait from an empty reply.
function contentOf(message: ThreadTranscriptEntry): string {
  const error = message["errorMessage"]
  if (message["stopReason"] !== "error" || typeof error !== "string")
    return JSON.stringify(message["content"] ?? message)
  // Never the whole message here: it carries the uncapped errorMessage the item caps below.
  const content = message["content"]
  const parts = content === undefined ? [] : Array.isArray(content) ? content : [content]
  return JSON.stringify([...parts, { type: "error", text: error.slice(0, ERROR_TEXT_MAX_CHARS) }])
}

/**
 * One read item. `seq` is its position in this answer only (1 is the oldest returned), never the same message across
 * reads; `id` (`<entryId>:<index>`) is, on every leg that pages entries, and is absent where the engine gives none.
 */
export function readItem(message: ThreadTranscriptEntry, index: number, id: string | undefined) {
  return {
    seq: index + 1,
    ...(id === undefined ? {} : { id }),
    role: transcriptRole(message["role"]),
    content: contentOf(message),
  }
}

/** A slice's messages as items, each with its id when the leg named one. */
export function readItems(messages: readonly ThreadTranscriptEntry[], ids: readonly string[] | undefined) {
  return messages.map((message, index) => readItem(message, index, ids?.[index]))
}
