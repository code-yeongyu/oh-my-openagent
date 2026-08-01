import { readFile } from "node:fs/promises"

const SESSION_TAIL_BYTES = 64 * 1024

export async function sessionTailNeedsContinuation(sessionPath: string): Promise<boolean> {
  try {
    const text = await readTail(sessionPath)
    const lastMessage = lastSessionMessage(text)
    if (lastMessage === undefined) return false
    if (lastMessage.message.role === "user" || lastMessage.message.role === "toolResult") return true
    if (lastMessage.message.role !== "assistant" || !Array.isArray(lastMessage.message.content)) return false
    return lastMessage.message.content.some((part) => isRecord(part) && part.type === "toolCall")
  } catch {
    return false
  }
}

async function readTail(sessionPath: string): Promise<string> {
  const file = await readFile(sessionPath)
  if (file.byteLength <= SESSION_TAIL_BYTES) return file.toString("utf8")
  return file.subarray(file.byteLength - SESSION_TAIL_BYTES).toString("utf8")
}

type SessionMessageEntry = {
  readonly type: "message"
  readonly message: {
    readonly role?: string
    readonly content?: readonly unknown[]
  }
}

function lastSessionMessage(text: string): SessionMessageEntry | undefined {
  const lines = text.split("\n")
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim()
    if (line.length === 0) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line) as unknown
    } catch {
      continue
    }
    if (!isSessionMessageEntry(parsed)) continue
    return parsed
  }
  return undefined
}

function isSessionMessageEntry(value: unknown): value is SessionMessageEntry {
  return isRecord(value) && value.type === "message" && isRecord(value.message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
