import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

// Detects whether a delivered peer_message envelope has landed in the member's session JSONL.
// This is the delivery ack the self-poller uses before committing a reservation.
export async function sessionJsonlContainsMessage(sessionDir: string, messageId: string): Promise<boolean> {
  let entries: string[]
  try {
    entries = (await readdir(sessionDir)).filter((name) => name.endsWith(".jsonl")).toSorted()
  } catch (error) {
    if (isMissingPath(error)) return false
    throw error
  }

  for (const entry of entries) {
    const text = await readFile(join(sessionDir, entry), "utf8")
    for (const line of text.split("\n")) {
      const value = parseJsonLine(line)
      if (containsEnvelopeMarker(value, messageId)) return true
    }
  }
  return false
}

export function isMissingPath(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

function parseJsonLine(line: string): unknown {
  if (line.trim().length === 0) return undefined
  try {
    return JSON.parse(line)
  } catch (error) {
    if (error instanceof SyntaxError) return undefined
    throw error
  }
}

function containsEnvelopeMarker(value: unknown, messageId: string): boolean {
  if (typeof value === "string") {
    return value.includes("<peer_message ") && value.includes(`messageId="${messageId}"`)
  }
  if (Array.isArray(value)) return value.some((entry) => containsEnvelopeMarker(entry, messageId))
  if (!isRecord(value)) return false
  return Object.values(value).some((entry) => containsEnvelopeMarker(entry, messageId))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
