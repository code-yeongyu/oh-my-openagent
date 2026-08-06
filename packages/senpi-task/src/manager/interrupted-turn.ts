import { open } from "node:fs/promises"

const INITIAL_TAIL_BYTES = 64 * 1024

export async function sessionTailNeedsContinuation(sessionPath: string): Promise<boolean> {
  try {
    const line = await readLastJsonlLine(sessionPath)
    if (line === undefined) return false
    const parsed = JSON.parse(line) as unknown
    if (!isSessionMessageEntry(parsed)) return false
    const message = parsed.message
    if (message.role === "user" || message.role === "toolResult") return true
    if (message.role !== "assistant") return false
    if (message.stopReason === "aborted") return true
    if (!Array.isArray(message.content)) return false
    return message.content.some((part) => isRecord(part) && part.type === "toolCall")
  } catch {
    return false
  }
}

// Read the ACTUAL final non-empty JSONL record. Start with the normal 64 KiB tail, but if that
// window begins in the middle of an oversized final line, grow backwards until its delimiter (or
// the start of file) is included. Never skip a malformed final record and reinterpret an earlier
// user message as unanswered.
async function readLastJsonlLine(sessionPath: string): Promise<string | undefined> {
  const file = await open(sessionPath, "r")
  try {
    const size = (await file.stat()).size
    if (size === 0) return undefined
    let bytes = Math.min(size, INITIAL_TAIL_BYTES)
    for (;;) {
      const start = size - bytes
      const buffer = Buffer.allocUnsafe(bytes)
      const { bytesRead } = await file.read(buffer, 0, bytes, start)
      const text = buffer.subarray(0, bytesRead).toString("utf8").replace(/[\r\n]+$/, "")
      if (text.length === 0) return undefined
      const delimiter = text.lastIndexOf("\n")
      if (delimiter >= 0) return text.slice(delimiter + 1).trim() || undefined
      if (start === 0) return text.trim() || undefined
      bytes = Math.min(size, bytes * 2)
    }
  } finally {
    await file.close()
  }
}

type SessionMessageEntry = {
  readonly type: "message"
  readonly message: {
    readonly role?: string
    readonly content?: readonly unknown[]
    readonly stopReason?: string
  }
}

function isSessionMessageEntry(value: unknown): value is SessionMessageEntry {
  return isRecord(value) && value.type === "message" && isRecord(value.message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
