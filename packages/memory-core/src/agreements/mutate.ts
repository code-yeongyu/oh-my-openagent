import { agreementId, normalizeAgreementText, sortAgreements } from "./format"
import type { AgreementExtractionRecord, AgreementItem, AgreementScope, AgreementsPolicy } from "./types"

export interface AgreementsMutation {
  readonly items: readonly AgreementItem[]
  readonly newlyFlagged: readonly string[]
  readonly events: readonly AgreementEvent[]
}

export type AgreementEvent =
  | { readonly kind: "evicted"; readonly date: string; readonly item: AgreementItem; readonly forText: string }
  | { readonly kind: "refused"; readonly date: string; readonly text: string }
  | { readonly kind: "stale-reaffirm"; readonly date: string; readonly id: string }

export function applyAgreementRecords(
  existing: readonly AgreementItem[],
  records: readonly AgreementExtractionRecord[],
  policy: AgreementsPolicy,
): AgreementsMutation {
  let items = [...existing]
  const committed = new Set(existing.map((item) => item.id))
  const flagged = new Set<string>()
  const events: AgreementEvent[] = []
  const bump = (at: number, date: string, text: string | undefined): void => {
    const found = items[at]
    if (found === undefined) return
    const n = found.n + 1
    const reworded = found.by === "agent" && text !== undefined ? text : found.text
    const status = n >= policy.needsHumanThreshold ? "needs-human" : found.status
    if (status === "needs-human" && found.status !== "needs-human") flagged.add(found.id)
    items[at] = { ...found, text: reworded, n, last: date, status }
  }
  for (const record of records) {
    if (record.action === "reaffirm") {
      const at = items.findIndex((item) => item.id === record.id)
      if (at < 0) events.push({ kind: "stale-reaffirm", date: record.date, id: record.id })
      else bump(at, record.date, record.text)
      continue
    }
    const at = findAgreement(items, record.text)
    if (at >= 0) {
      bump(at, record.date, undefined)
      continue
    }
    const status = 1 >= policy.needsHumanThreshold ? "needs-human" : "active"
    const created: AgreementItem = {
      id: agreementId(record.text), scope: record.applies, by: "agent", text: record.text,
      n: 1, since: record.date, last: record.date, status,
    }
    if (items.length >= policy.maxItems) {
      const victim = evictionCandidate(items.filter((item) => committed.has(item.id)))
      if (victim === undefined) {
        events.push({ kind: "refused", date: record.date, text: record.text })
        continue
      }
      items = items.filter((item) => item.id !== victim.id)
      events.push({ kind: "evicted", date: record.date, item: victim, forText: record.text })
    }
    if (status === "needs-human") flagged.add(created.id)
    items.push(created)
  }
  return { items: sortAgreements(items), newlyFlagged: [...flagged], events }
}

/** At the cap only a committed agent item that was never reaffirmed and is not flagged may go: the oldest one. */
function evictionCandidate(items: readonly AgreementItem[]): AgreementItem | undefined {
  return items
    .filter((item) => item.by === "agent" && item.status === "active" && item.n <= 1)
    .sort((a, b) => (a.last ?? a.since ?? "").localeCompare(b.last ?? b.since ?? "") || a.id.localeCompare(b.id))[0]
}

export function addHumanAgreement(
  existing: readonly AgreementItem[],
  text: string,
  scope: AgreementScope,
  date: string,
): readonly AgreementItem[] {
  const at = findAgreement(existing, text)
  const found = at >= 0 ? existing[at] : undefined
  const item: AgreementItem = found === undefined
    ? { id: agreementId(text), scope, by: "human", text, n: 0, since: date, status: "active" }
    : { ...found, scope, by: "human", text }
  const rest = existing.filter((_, index) => index !== at)
  return sortAgreements([...rest, item])
}

export function ackAgreement(existing: readonly AgreementItem[], id: string): readonly AgreementItem[] | undefined {
  if (!existing.some((item) => item.id === id)) return undefined
  return existing.map((item) => item.id === id ? { ...item, n: 0, status: "active" } : item)
}

export function dropAgreement(existing: readonly AgreementItem[], id: string): readonly AgreementItem[] | undefined {
  if (!existing.some((item) => item.id === id)) return undefined
  return existing.filter((item) => item.id !== id)
}

function findAgreement(items: readonly AgreementItem[], text: string): number {
  const id = agreementId(text)
  const normalized = normalizeAgreementText(text)
  return items.findIndex((item) => item.id === id || normalizeAgreementText(item.text) === normalized)
}
