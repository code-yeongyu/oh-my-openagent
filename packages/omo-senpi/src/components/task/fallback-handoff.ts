const LATEST_USER_MAX_BYTES = 8192
const COMPACTION_MAX_BYTES = 8192
const TODO_MAX_BYTES = 8192
const TAIL_MESSAGE_MAX_BYTES = 4096
const SOURCE_SELECTOR_MAX_BYTES = 512
const SOURCE_ERROR_MAX_BYTES = 2048
const REQUEST_ID_MAX_BYTES = 256

type FallbackSource = {
  readonly chainKey: string
  readonly from: string
  readonly lastError: string
  readonly lastErrorSha256: string
}

type RecentMessage = {
  readonly role: "user" | "assistant" | "toolResult"
  readonly content: string
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
  const failedIndex = latestMessageIndex(input.entries)
  if (
    failedIndex < 0
    || !isFailedAssistantEntry(input.entries[failedIndex], input.source.lastErrorSha256)
  ) {
    return undefined
  }
  const failedMessage = field(input.entries[failedIndex], "message")
  if (hasAssistantOutput(field(failedMessage, "content"))) return undefined

  const userIndex = previousMessageIndex(input.entries, failedIndex)
  if (userIndex < 0 || field(field(input.entries[userIndex], "message"), "role") !== "user") {
    return undefined
  }
  const requestId = stringValue(field(input.entries[failedIndex], "id"))
  const latestUser = textContent(field(field(input.entries[userIndex], "message"), "content"), LATEST_USER_MAX_BYTES).trim()
  if (requestId === undefined || latestUser.length === 0) return undefined

  const sectionBudget = Math.max(1, Math.floor(input.maxBytes * 0.2))
  const tailMessageBudget = Math.max(
    1,
    Math.floor(sectionBudget / Math.max(1, input.recentTailMessages)),
  )
  const context = collectContext({
    entries: input.entries,
    userIndex,
    recentTailMessages: input.recentTailMessages,
    tailMessageBytes: Math.min(TAIL_MESSAGE_MAX_BYTES, tailMessageBudget),
    compactionBytes: Math.min(COMPACTION_MAX_BYTES, sectionBudget),
    todoBytes: Math.min(TODO_MAX_BYTES, sectionBudget),
  })
  const payload = {
    schema: "omo.fallback-delegate.v1",
    request_id: truncateUtf8(requestId, REQUEST_ID_MAX_BYTES),
    latest_user: truncateUtf8(latestUser, Math.min(LATEST_USER_MAX_BYTES, sectionBudget)),
    compaction: context.compaction,
    todo: context.todo,
    recent_tail: context.recentTail,
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
    } else if (payload.source.last_error.length > 0) {
      payload.source.last_error = shrink(payload.source.last_error)
    } else if (payload.source.chain_key.length > 0) {
      payload.source.chain_key = shrink(payload.source.chain_key)
    } else if (payload.source.from.length > 0) {
      payload.source.from = shrink(payload.source.from)
    } else if (payload.latest_user.length > 0) {
      payload.latest_user = shrink(payload.latest_user)
    } else {
      return undefined
    }
    prompt = JSON.stringify(payload)
  }
  return { requestId, prompt }
}

function collectContext(input: {
  readonly entries: readonly unknown[]
  readonly userIndex: number
  readonly recentTailMessages: number
  readonly tailMessageBytes: number
  readonly compactionBytes: number
  readonly todoBytes: number
}): { readonly compaction: string; readonly todo: string; readonly recentTail: RecentMessage[] } {
  let compaction = ""
  let todo = ""
  let foundCompaction = false
  let foundTodo = false
  for (let index = input.entries.length - 1; index >= 0 && (!foundCompaction || !foundTodo); index -= 1) {
    const entry = input.entries[index]
    const type = field(entry, "type")
    if (!foundCompaction && type === "compaction") {
      foundCompaction = true
      const summary = field(entry, "summary")
      if (typeof summary === "string") compaction = truncateUtf8(summary, input.compactionBytes)
    }
    if (!foundTodo && type === "custom" && field(entry, "customType") === "senpi.todo-state") {
      foundTodo = true
      todo = todoText(field(entry, "data"), input.todoBytes)
    }
  }

  const recentTail: RecentMessage[] = []
  for (
    let index = input.userIndex - 1;
    index >= 0 && recentTail.length < input.recentTailMessages;
    index -= 1
  ) {
    const entry = input.entries[index]
    if (field(entry, "type") !== "message") continue
    const message = field(entry, "message")
    const role = field(message, "role")
    if (role !== "user" && role !== "assistant" && role !== "toolResult") continue
    const content = textContent(field(message, "content"), input.tailMessageBytes).trim()
    if (content.length > 0) recentTail.unshift({ role, content })
  }
  return { compaction, todo, recentTail }
}

function latestMessageIndex(entries: readonly unknown[]): number {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (field(entries[index], "type") === "message") return index
  }
  return -1
}

function previousMessageIndex(entries: readonly unknown[], before: number): number {
  for (let index = before - 1; index >= 0; index -= 1) {
    if (field(entries[index], "type") === "message") return index
  }
  return -1
}

function isFailedAssistantEntry(value: unknown, expectedErrorSha256: string): boolean {
  if (field(value, "type") !== "message") return false
  const message = field(value, "message")
  const error = field(message, "errorMessage")
  return (
    field(message, "role") === "assistant"
    && (field(message, "stopReason") === "error" || field(message, "stopReason") === "aborted")
    && typeof error === "string"
    && createHash("sha256").update(error).digest("hex") === expectedErrorSha256
  )
}

function hasAssistantOutput(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0
  if (!Array.isArray(value)) return value !== undefined && value !== null
  return value.some((part) => {
    if (field(part, "type") !== "text") return true
    const text = field(part, "text")
    return typeof text !== "string" || text.trim().length > 0
  })
}

function textContent(value: unknown, maxBytes: number): string {
  if (typeof value === "string") return truncateUtf8(value, maxBytes)
  if (!Array.isArray(value)) return ""
  let output = ""
  for (const part of value) {
    if (field(part, "type") !== "text") continue
    const text = field(part, "text")
    if (typeof text !== "string" || text.length === 0) continue
    const separator = output.length === 0 ? "" : "\n"
    output = appendBounded(output, `${separator}${text}`, maxBytes)
    if (Buffer.byteLength(output) >= maxBytes) break
  }
  return output
}

function todoText(value: unknown, maxBytes: number): string {
  if (field(value, "schema") !== "v2") return ""
  const phases = field(value, "phases")
  if (!Array.isArray(phases)) return ""
  let output = ""
  outer: for (const phase of phases) {
    const name = field(phase, "name")
    const tasks = field(phase, "tasks")
    if (typeof name !== "string" || !Array.isArray(tasks)) continue
    output = appendBounded(output, `${output.length === 0 ? "" : "\n"}[${name}]\n`, maxBytes)
    for (const task of tasks) {
      const content = field(task, "content")
      const status = field(task, "status")
      if (typeof content !== "string" || typeof status !== "string") continue
      output = appendBounded(output, `- ${status}: ${content}\n`, maxBytes)
      if (Buffer.byteLength(output) >= maxBytes) break outer
    }
  }
  return output
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? Reflect.get(value, key)
    : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function appendBounded(current: string, addition: string, maxBytes: number): string {
  const remaining = maxBytes - Buffer.byteLength(current)
  return remaining <= 0 ? current : current + truncateUtf8(addition, remaining)
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
import { createHash } from "node:crypto"

