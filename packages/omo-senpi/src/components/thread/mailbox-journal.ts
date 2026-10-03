import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeSync,
} from "node:fs"
import { join } from "node:path"

import { writeFileAtomically } from "@oh-my-opencode/utils/atomic-write"

import type { MailboxItem } from "./mailbox"
import {
  type LegacyStoredState,
  type MailboxJournalEvent,
  type MailboxSnapshot,
  parseJournalEvent,
  parseLegacyStoredState,
} from "./mailbox-journal-codec"

const JOURNAL_COMPACT_EVENTS = 256

export type MailboxJournal = {
  readonly nextSequence: () => number
  readonly pending: (target: string) => readonly MailboxItem[]
  readonly enqueue: (item: MailboxItem) => void
  readonly remove: (messageSeq: number) => void
}

export function createMailboxJournal(directory: string): MailboxJournal {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const journalPath = join(directory, "mailbox.jsonl")
  const legacyPath = join(directory, "mailbox.json")
  const loaded = loadJournal(journalPath)
  const legacy = loaded === null ? loadLegacyState(legacyPath) : null
  const items = new Map<number, MailboxItem>()
  let nextSequence = 1
  let eventCount = 0

  if (loaded !== null) {
    nextSequence = loaded.nextSequence
    eventCount = loaded.eventCount
    for (const item of loaded.items) items.set(item.message_seq, item)
    rmSync(legacyPath, { force: true })
  } else if (legacy !== null) {
    for (const queue of Object.values(legacy.queues)) {
      for (const item of queue) items.set(item.message_seq, item)
    }
    nextSequence = Math.max(legacy.next_seq, ...[...items.values()].map((item) => item.message_seq + 1))
    writeSnapshot(journalPath, nextSequence, items.values())
    eventCount = 1
    rmSync(legacyPath, { force: true })
  } else {
    writeSnapshot(journalPath, nextSequence, [])
    eventCount = 1
  }

  return {
    nextSequence: () => nextSequence,
    pending: (target) => [...items.values()]
      .filter((item) => item.target === target)
      .toSorted((left, right) => left.message_seq - right.message_seq),
    enqueue: (item) => {
      if (item.message_seq !== nextSequence) {
        throw new Error(`Mailbox sequence mismatch: expected ${nextSequence}, received ${item.message_seq}.`)
      }
      appendEvent(journalPath, { version: 1, kind: "enqueue", item })
      items.set(item.message_seq, item)
      nextSequence++
      eventCount++
    },
    remove: (messageSeq) => {
      if (!items.has(messageSeq)) return
      if (items.size === 1 || eventCount + 1 >= JOURNAL_COMPACT_EVENTS) {
        const remaining = [...items.values()].filter((item) => item.message_seq !== messageSeq)
        writeSnapshot(journalPath, nextSequence, remaining)
        items.delete(messageSeq)
        eventCount = 1
        return
      }
      appendEvent(journalPath, { version: 1, kind: "remove", message_seq: messageSeq })
      items.delete(messageSeq)
      eventCount++
    },
  }
}

function loadJournal(path: string): {
  readonly nextSequence: number
  readonly items: readonly MailboxItem[]
  readonly eventCount: number
} | null {
  if (!existsSync(path)) return null
  let nextSequence = 1
  const items = new Map<number, MailboxItem>()
  const content = readFileSync(path, "utf8")
  const completeBytes = content.lastIndexOf("\n") + 1
  const completeContent = content.slice(0, completeBytes)
  if (completeBytes !== content.length) writeFileAtomically(path, completeContent)
  const lines = completeContent.split("\n").filter((line) => line.length > 0)
  if (lines.length === 0) return null
  for (const line of lines) {
    const event = parseJournalEvent(JSON.parse(line))
    switch (event.kind) {
      case "snapshot":
        items.clear()
        for (const item of event.items) items.set(item.message_seq, item)
        nextSequence = Math.max(event.next_seq, ...event.items.map((item) => item.message_seq + 1))
        break
      case "enqueue":
        items.set(event.item.message_seq, event.item)
        nextSequence = Math.max(nextSequence, event.item.message_seq + 1)
        break
      case "remove":
        items.delete(event.message_seq)
        break
      default: {
        const unreachable: never = event
        throw new Error(`Unexpected mailbox journal event: ${String(unreachable)}`)
      }
    }
  }
  return { nextSequence, items: [...items.values()], eventCount: lines.length }
}

function loadLegacyState(path: string): LegacyStoredState | null {
  if (!existsSync(path)) return null
  return parseLegacyStoredState(JSON.parse(readFileSync(path, "utf8")), path)
}

function appendEvent(path: string, event: MailboxJournalEvent): void {
  const fileDescriptor = openSync(path, "r+")
  const originalSize = fstatSync(fileDescriptor).size
  try {
    const content = Buffer.from(`${JSON.stringify(event)}\n`, "utf8")
    let written = 0
    while (written < content.length) {
      const count = writeSync(fileDescriptor, content, written, content.length - written, originalSize + written)
      if (count === 0) throw new Error("Mailbox journal append made no progress.")
      written += count
    }
    fsyncSync(fileDescriptor)
  } catch (error) {
    ftruncateSync(fileDescriptor, originalSize)
    fsyncSync(fileDescriptor)
    throw error
  } finally {
    closeSync(fileDescriptor)
  }
}

function writeSnapshot(path: string, nextSequence: number, items: Iterable<MailboxItem>): void {
  const snapshot: MailboxSnapshot = {
    version: 1,
    kind: "snapshot",
    next_seq: nextSequence,
    items: [...items].toSorted((left, right) => left.message_seq - right.message_seq),
  }
  writeFileAtomically(path, `${JSON.stringify(snapshot)}\n`)
}
