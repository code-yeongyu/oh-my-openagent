import { open } from "node:fs/promises"

const INITIAL_TAIL_BYTES = 64 * 1024

const BOOKKEEPING_CUSTOM_TYPES = new Set([
  "senpi.hooks.stop-state",
  "pi-rules.scan",
  "senpi-memory.session-binding",
])

export async function sessionTailNeedsContinuation(
  sessionPath: string,
  ignoredUserPrompt?: string,
): Promise<boolean> {
  try {
    const tail = await readConversationTail(sessionPath)
    if (tail === undefined) return false
    if (tail.turnUser !== undefined && isIgnoredUserPrompt(tail.turnUser, ignoredUserPrompt)) return false
    return messageNeedsContinuation(tail.lastMessage)
  } catch {
    return false
  }
}

/**
 * The final answer of a turn that already ENDED in the transcript: the last conversation message is
 * an assistant reply that stopped normally with text and no pending tool call. A child whose turn
 * finished while no parent was attached never delivers that end again, so a revival reads it here.
 */
export async function sessionTailFinishedText(sessionPath: string): Promise<string | undefined> {
  try {
    const tail = await readConversationTail(sessionPath)
    const last = tail?.lastMessage
    if (last === undefined || last.role !== "assistant" || last.stopReason !== "stop") return undefined
    if (messageNeedsContinuation(last) || !Array.isArray(last.content)) return undefined
    const text = last.content
      .filter((part): part is { type: "text"; text: string } => isRecord(part) && part.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("")
    return text.length > 0 ? text : undefined
  } catch {
    return undefined
  }
}

function messageNeedsContinuation(message: SessionMessageEntry["message"]): boolean {
  if (message.role === "user") return true
  if (message.role === "toolResult") return true
  if (message.role !== "assistant") return false
  if (message.stopReason === "aborted") return true
  if (!Array.isArray(message.content)) return false
  return message.content.some((part) => isRecord(part) && part.type === "toolCall")
}

type TailVerdict =
  | { readonly kind: "message"; readonly message: SessionMessageEntry["message"] }
  | { readonly kind: "skip" }
  | { readonly kind: "stop" }

type ConversationTail = {
  readonly lastMessage: SessionMessageEntry["message"]
  readonly turnUser?: SessionMessageEntry["message"]
}

// Walk back from the ACTUAL final non-empty JSONL record over bookkeeping entries to the last
// conversation turn. The nearest user message is the durable marker for whether this turn is our
// own already-delivered continuation, including when another host stop appended an aborted assistant
// row after it. Start with the normal 64 KiB tail and grow backwards whenever the window's complete
// records are exhausted (an oversized record, or a long bookkeeping run). Before the last message is
// found, an entry of an unknown type ends the walk undecided: it is never skipped to reinterpret an
// earlier user message as unanswered. Once the last message is known, the search for the turn's
// opening user message walks past every other row (a hook's custom_message, an extension's custom
// entry), so such a row can never hide our own continuation prompt. A malformed record throws at any
// point, which the caller reads as no continuation.
async function readConversationTail(sessionPath: string): Promise<ConversationTail | undefined> {
  const file = await open(sessionPath, "r")
  try {
    const size = (await file.stat()).size
    if (size === 0) return undefined
    let bytes = Math.min(size, INITIAL_TAIL_BYTES)
    let processedTailLines = 0
    let lastMessage: SessionMessageEntry["message"] | undefined
    for (;;) {
      const start = size - bytes
      const buffer = Buffer.allocUnsafe(bytes)
      const { bytesRead } = await file.read(buffer, 0, bytes, start)
      const lines = buffer.subarray(0, bytesRead).toString("utf8").split("\n")
      // A window that does not begin the file may begin mid-record; that record is re-read whole
      // once the window grows past its start.
      const complete = start === 0 ? lines : lines.slice(1)
      const newEnd = Math.max(0, complete.length - processedTailLines)
      for (let index = newEnd - 1; index >= 0; index -= 1) {
        const line = complete[index]?.trim() ?? ""
        if (line.length === 0) continue
        const verdict = classifyRecord(line)
        if (verdict.kind === "message") {
          if (lastMessage === undefined) {
            lastMessage = verdict.message
            if (!messageNeedsContinuation(lastMessage)) return { lastMessage }
          }
          if (verdict.message.role === "user") {
            return { lastMessage, turnUser: verdict.message }
          }
          if (verdict.message.role === "assistant" && !messageNeedsContinuation(verdict.message)) {
            return { lastMessage }
          }
        }
        if (verdict.kind === "stop" && lastMessage === undefined) return undefined
      }
      if (start === 0) return lastMessage === undefined ? undefined : { lastMessage }
      processedTailLines = complete.length
      bytes = Math.min(size, bytes * 2)
    }
  } finally {
    await file.close()
  }
}

function classifyRecord(line: string): TailVerdict {
  const parsed: unknown = JSON.parse(line)
  if (isSessionMessageEntry(parsed)) return { kind: "message", message: parsed.message }
  if (isNamedBookkeepingEntry(parsed)) return { kind: "skip" }
  return { kind: "stop" }
}

type SessionMessageEntry = {
  readonly type: "message"
  readonly message: {
    readonly role?: string
    readonly content?: unknown
    readonly stopReason?: string
  }
}

function isSessionMessageEntry(value: unknown): value is SessionMessageEntry {
  return isRecord(value) && value.type === "message" && isRecord(value.message)
}

function isNamedBookkeepingEntry(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.type === "custom" &&
    typeof value.customType === "string" &&
    BOOKKEEPING_CUSTOM_TYPES.has(value.customType)
  )
}

function isIgnoredUserPrompt(message: SessionMessageEntry["message"], ignoredUserPrompt: string | undefined): boolean {
  if (ignoredUserPrompt === undefined) return false
  if (message.content === ignoredUserPrompt) return true
  if (!Array.isArray(message.content) || message.content.length !== 1) return false
  const part = message.content[0]
  return isRecord(part) && part.type === "text" && part.text === ignoredUserPrompt
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
