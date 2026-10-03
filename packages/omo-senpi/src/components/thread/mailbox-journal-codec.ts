import type { MailboxItem } from "./mailbox"

export type MailboxSnapshot = {
  readonly version: 1
  readonly kind: "snapshot"
  readonly next_seq: number
  readonly items: readonly MailboxItem[]
}

export type MailboxEnqueue = {
  readonly version: 1
  readonly kind: "enqueue"
  readonly item: MailboxItem
}

export type MailboxRemove = {
  readonly version: 1
  readonly kind: "remove"
  readonly message_seq: number
}

export type MailboxJournalEvent = MailboxSnapshot | MailboxEnqueue | MailboxRemove

export type LegacyStoredState = {
  readonly next_seq: number
  readonly queues: Readonly<Record<string, readonly MailboxItem[]>>
}

export function parseLegacyStoredState(value: unknown, path: string): LegacyStoredState {
  if (
    !isRecord(value) ||
    !Number.isInteger(value.next_seq) ||
    typeof value.next_seq !== "number" ||
    value.next_seq < 1 ||
    !isRecord(value.queues)
  ) {
    throw new Error(`Invalid legacy mailbox state: ${path}`)
  }
  const queues: Record<string, readonly MailboxItem[]> = {}
  for (const [target, queue] of Object.entries(value.queues)) {
    if (!Array.isArray(queue)) throw new Error(`Invalid legacy mailbox queue: ${target}`)
    queues[target] = queue.map(parseMailboxItem)
  }
  return { next_seq: value.next_seq, queues }
}

export function parseJournalEvent(value: unknown): MailboxJournalEvent {
  if (!isRecord(value) || value.version !== 1 || typeof value.kind !== "string") {
    throw new Error("Invalid mailbox journal event.")
  }
  if (value.kind === "enqueue") {
    return { version: 1, kind: "enqueue", item: parseMailboxItem(value.item) }
  }
  if (value.kind === "remove" && typeof value.message_seq === "number" && Number.isInteger(value.message_seq)) {
    return { version: 1, kind: "remove", message_seq: value.message_seq }
  }
  if (
    value.kind === "snapshot" &&
    typeof value.next_seq === "number" &&
    Number.isInteger(value.next_seq) &&
    value.next_seq >= 1 &&
    Array.isArray(value.items)
  ) {
    return {
      version: 1,
      kind: "snapshot",
      next_seq: value.next_seq,
      items: value.items.map(parseMailboxItem),
    }
  }
  throw new Error("Invalid mailbox journal event.")
}

function parseMailboxItem(value: unknown): MailboxItem {
  if (
    !isRecord(value) ||
    typeof value.target !== "string" ||
    typeof value.message !== "string" ||
    typeof value.message_seq !== "number" ||
    !Number.isInteger(value.message_seq) ||
    value.message_seq < 1 ||
    !isDeliveryMode(value.delivery) ||
    typeof value.operation_id !== "string" ||
    typeof value.accepted_at !== "string" ||
    (value.expected_turn_id !== undefined && typeof value.expected_turn_id !== "string")
  ) {
    throw new Error("Invalid mailbox item.")
  }
  return {
    target: value.target,
    message: value.message,
    message_seq: value.message_seq,
    delivery: value.delivery,
    ...(value.expected_turn_id === undefined ? {} : { expected_turn_id: value.expected_turn_id }),
    operation_id: value.operation_id,
    accepted_at: value.accepted_at,
  }
}

function isDeliveryMode(value: unknown): value is MailboxItem["delivery"] {
  return value === "auto" || value === "steer" || value === "follow_up"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
