import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import type { GatewayDeliveryMode } from "./types"

export type LegacyMailboxItem = {
  readonly target: string
  readonly message: string
  readonly message_seq: number
  readonly delivery: GatewayDeliveryMode
  readonly operation_id: string
  readonly accepted_at: string
}

/**
 * Reads the pre-gateway sender-local mailbox (`<thread state dir>/mailbox`, where the thread state
 * dir is `resolveProjectStateDirectory(cwd, "thread-tools")` since #9201): the
 * `mailbox.jsonl` journal (snapshot/enqueue/remove events; a torn last line is ignored) or, when
 * absent, the older `mailbox.json` state. Kept independent of the journal module it replaces so
 * that module can be deleted once the tools route through the gateway.
 */
export function readLegacyMailbox(directory: string): readonly LegacyMailboxItem[] | null {
  const journalPath = join(directory, "mailbox.jsonl")
  if (existsSync(journalPath)) return replayJournal(readFileSync(journalPath, "utf8"))
  const statePath = join(directory, "mailbox.json")
  if (!existsSync(statePath)) return null
  const state: unknown = JSON.parse(readFileSync(statePath, "utf8"))
  if (!isRecord(state) || !isRecord(state.queues)) throw new Error(`invalid legacy mailbox state: ${statePath}`)
  const items: LegacyMailboxItem[] = []
  for (const queue of Object.values(state.queues)) {
    if (!Array.isArray(queue)) throw new Error(`invalid legacy mailbox queue: ${statePath}`)
    for (const item of queue) items.push(parseItem(item))
  }
  return sortItems(items)
}

function replayJournal(content: string): readonly LegacyMailboxItem[] {
  const complete = content.slice(0, content.lastIndexOf("\n") + 1)
  const items = new Map<number, LegacyMailboxItem>()
  for (const line of complete.split("\n")) {
    if (line.length === 0) continue
    const event: unknown = JSON.parse(line)
    if (!isRecord(event) || event.version !== 1) throw new Error("invalid legacy mailbox event")
    if (event.kind === "snapshot" && Array.isArray(event.items)) {
      items.clear()
      for (const item of event.items) {
        const parsed = parseItem(item)
        items.set(parsed.message_seq, parsed)
      }
    } else if (event.kind === "enqueue") {
      const parsed = parseItem(event.item)
      items.set(parsed.message_seq, parsed)
    } else if (event.kind === "remove" && typeof event.message_seq === "number") {
      items.delete(event.message_seq)
    } else {
      throw new Error("invalid legacy mailbox event")
    }
  }
  return sortItems([...items.values()])
}

function sortItems(items: readonly LegacyMailboxItem[]): readonly LegacyMailboxItem[] {
  return items.toSorted((left, right) => left.message_seq - right.message_seq)
}

function parseItem(value: unknown): LegacyMailboxItem {
  if (
    !isRecord(value) ||
    typeof value.target !== "string" ||
    typeof value.message !== "string" ||
    typeof value.message_seq !== "number" ||
    !Number.isInteger(value.message_seq) ||
    (value.delivery !== "auto" && value.delivery !== "steer" && value.delivery !== "follow_up") ||
    typeof value.operation_id !== "string" ||
    typeof value.accepted_at !== "string"
  ) {
    throw new Error("invalid legacy mailbox item")
  }
  return {
    target: value.target,
    message: value.message,
    message_seq: value.message_seq,
    delivery: value.delivery,
    operation_id: value.operation_id,
    accepted_at: value.accepted_at,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
