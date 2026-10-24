import { createHash } from "node:crypto"

import type { AgreementExtractionRecord, AgreementItem } from "./types"

const PREFIX = "<!-- agreement-event:"
const LINE = /^<!-- agreement-event: ([0-9a-f]{64}) -->$/

export function parseAgreementEventLine(line: string): string | undefined {
  if (!line.startsWith(PREFIX)) return undefined
  return LINE.exec(line)?.[1]
}

export function serializeAgreementEvents(keys: readonly string[]): string[] {
  return [...new Set(keys)].sort().map((key) => `${PREFIX} ${key} -->`)
}

export function agreementEventKey(id: string, record: AgreementExtractionRecord): string {
  return record.source === undefined
    ? legacyAgreementEventKey(id, record.date)
    : digest(["source-v1", id, record.source.sessionId, record.source.messageId])
}

export function legacyAgreementEventKey(id: string, date: string): string {
  return digest(["legacy-v1", id, date])
}

export function legacyAgreementEvents(items: readonly AgreementItem[]): string[] {
  return items.flatMap((item) => item.last === undefined ? [] : [
    legacyAgreementEventKey(item.id, item.last),
  ])
}

function digest(parts: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex")
}
