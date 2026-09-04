const LATEST_USER_MAX_BYTES = 8192
const COMPACTION_MAX_BYTES = 8192
const TODO_MAX_BYTES = 8192
const TAIL_MESSAGE_MAX_BYTES = 4096
const SOURCE_SELECTOR_MAX_BYTES = 512
const SOURCE_ERROR_MAX_BYTES = 2048

type RecordValue = Readonly<Record<string, unknown>>

type FallbackSource = {
  readonly chainKey: string
  readonly from: string
  readonly lastError: string
}

export type FallbackHandoff = {
  readonly requestId: string
  readonly prompt: string
}

export function buildFallbackHandoff(input: {
  readonly entries: readonly unknown[]
  readonly maxBytes: number
  readonly recentTailMessages: number
  readonly source: FallbackSource
}): FallbackHandoff | undefined {
  const failedIndex = input.entries.findLastIndex(isFailedAssistantEntry)
  if (failedIndex < 0) return undefined
  const failed = asRecord(input.entries[failedIndex])
  const failedMessage = asRecord(failed?.["message"])
  if (failed === undefined || failedMessage === undefined) return undefined
  if (textContent(failedMessage["content"]).trim().length > 0) return undefined

  const userIndex = input.entries
    .slice(0, failedIndex)
    .findLastIndex(isUserMessageEntry)
  if (userIndex < 0) return undefined
  const user = asRecord(input.entries[userIndex])
  const userMessage = asRecord(user?.["message"])
  const requestId = stringValue(failed["id"])
  const latestUser = textContent(userMessage?.["content"]).trim()
  if (user === undefined || requestId === undefined || latestUser.length === 0) return undefined

  const priorEntries = input.entries.slice(0, failedIndex)
  const sectionBudget = Math.floor(input.maxBytes * 0.2)
  const tailMessageBudget = Math.max(
    1,
    Math.floor(sectionBudget / Math.max(1, input.recentTailMessages)),
  )
  const payload = {
    schema: "omo.fallback-delegate.v1",
    request_id: requestId,
    latest_user: truncateUtf8(latestUser, Math.min(LATEST_USER_MAX_BYTES, sectionBudget)),
    compaction: truncateUtf8(latestCompaction(priorEntries), Math.min(COMPACTION_MAX_BYTES, sectionBudget)),
    todo: truncateUtf8(latestTodo(priorEntries), Math.min(TODO_MAX_BYTES, sectionBudget)),
    recent_tail: recentTail(
      priorEntries,
      stringValue(user["id"]),
      input.recentTailMessages,
      Math.min(TAIL_MESSAGE_MAX_BYTES, tailMessageBudget),
    ),
    source: {
      chain_key: truncateUtf8(input.source.chainKey, SOURCE_SELECTOR_MAX_BYTES),
      from: truncateUtf8(input.source.from, SOURCE_SELECTOR_MAX_BYTES),
      last_error: truncateUtf8(input.source.lastError, SOURCE_ERROR_MAX_BYTES),
    },
  }

  let prompt = JSON.stringify(payload)
  while (Buffer.byteLength(prompt) > input.maxBytes) {
    if (payload.recent_tail.length > 0) {
      payload.recent_tail.shift()
    } else if (payload.todo.length > 0) {
      payload.todo = shrink(payload.todo)
    } else if (payload.compaction.length > 0) {
      payload.compaction = shrink(payload.compaction)
    } else if (payload.latest_user.length > 0) {
      payload.latest_user = shrink(payload.latest_user)
    } else {
      return undefined
    }
    prompt = JSON.stringify(payload)
  }
  return { requestId, prompt }
}

function asRecord(value: unknown): RecordValue | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function isMessageEntry(value: unknown, role: string): boolean {
  const entry = asRecord(value)
  const message = asRecord(entry?.["message"])
  return entry?.["type"] === "message" && message?.["role"] === role
}

function isUserMessageEntry(value: unknown): boolean {
  return isMessageEntry(value, "user")
}

function isFailedAssistantEntry(value: unknown): boolean {
  if (!isMessageEntry(value, "assistant")) return false
  const message = asRecord(asRecord(value)?.["message"])
  return (
    (message?.["stopReason"] === "error" || message?.["stopReason"] === "aborted")
    && typeof message["errorMessage"] === "string"
  )
}

function textContent(value: unknown): string {
  if (typeof value === "string") return value
  if (!Array.isArray(value)) return ""
  return value
    .map((part) => {
      const block = asRecord(part)
      return block?.["type"] === "text" && typeof block["text"] === "string"
        ? block["text"]
        : ""
    })
    .filter((text) => text.length > 0)
    .join("\n")
}

function latestCompaction(entries: readonly unknown[]): string {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = asRecord(entries[index])
    if (entry?.["type"] === "compaction" && typeof entry["summary"] === "string") {
      return entry["summary"]
    }
  }
  return ""
}

function latestTodo(entries: readonly unknown[]): string {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = asRecord(entries[index])
    if (entry?.["type"] !== "custom" || entry["customType"] !== "senpi.todo-state") continue
    const data = asRecord(entry["data"])
    if (data?.["schema"] !== "v2" || !Array.isArray(data["phases"])) return ""
    const phases = data["phases"].flatMap((phase) => {
      const value = asRecord(phase)
      if (typeof value?.["name"] !== "string" || !Array.isArray(value["tasks"])) return []
      const tasks = value["tasks"].flatMap((task) => {
        const item = asRecord(task)
        return typeof item?.["content"] === "string" && typeof item["status"] === "string"
          ? [{ content: item["content"], status: item["status"] }]
          : []
      })
      return [{ name: value["name"], tasks }]
    })
    return JSON.stringify({ schema: "v2", phases })
  }
  return ""
}

function recentTail(
  entries: readonly unknown[],
  latestUserId: string | undefined,
  limit: number,
  messageMaxBytes: number,
): Array<{ role: string; content: string }> {
  if (limit === 0) return []
  return entries
    .flatMap((entry) => {
      const value = asRecord(entry)
      const message = asRecord(value?.["message"])
      if (value?.["type"] !== "message" || value["id"] === latestUserId || message === undefined) return []
      if (message["role"] !== "user" && message["role"] !== "assistant" && message["role"] !== "toolResult") return []
      const content = textContent(message["content"]).trim()
      return content.length === 0
        ? []
        : [{ role: message["role"], content: truncateUtf8(content, messageMaxBytes) }]
    })
    .slice(-limit)
}

function shrink(value: string): string {
  return truncateUtf8(value, Math.floor(Buffer.byteLength(value) * 0.75))
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value) <= maxBytes) return value
  let bytes = 0
  let output = ""
  for (const character of value) {
    const width = Buffer.byteLength(character)
    if (bytes + width > maxBytes) break
    output += character
    bytes += width
  }
  return output
}
