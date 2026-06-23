import { Mem0L2AdapterError } from "./errors"
import type {
  Mem0AddResultEntry,
  Mem0Memory,
  Mem0SearchResultEnvelope,
} from "./types"

export function pickFirstAddResult(
  result: Mem0AddResultEntry | Mem0AddResultEntry[],
): Mem0AddResultEntry | undefined {
  if (Array.isArray(result)) return result[0]
  return result
}

export function isNotFoundError(error: unknown): boolean {
  if (error instanceof Mem0L2AdapterError) {
    return error.statusCode === 404
  }

  if (!(error instanceof Error)) {
    return false
  }

  const message = error.message.toLowerCase()
  return message.includes("404") || message.includes("not found")
}

export function extractSearchMemories(
  raw: Mem0SearchResultEnvelope | Mem0Memory[],
): Mem0Memory[] {
  if (Array.isArray(raw)) return raw
  return raw.results ?? []
}
