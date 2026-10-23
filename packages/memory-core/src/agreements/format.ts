import { createHash } from "node:crypto"

import { normalizeObservationText } from "../facts/person-routing"
import type { AgreementAuthor, AgreementItem, AgreementScope, AgreementStatus } from "./types"

export interface AgreementsLedgerParse {
  readonly items: readonly AgreementItem[]
  readonly diagnostics: readonly string[]
  readonly unparsed: readonly string[]
}

const LINE_RE = /^-\s+\[(global|project)\]\s+(.+?)\s*(?:<!--\s*(.*?)\s*-->)?\s*$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const ID_RE = /^[0-9a-f]{10}$/

export function normalizeAgreementText(text: string): string {
  return normalizeObservationText(text)
}

export function agreementId(text: string): string {
  return createHash("sha256").update(normalizeAgreementText(text)).digest("hex").slice(0, 10)
}

export function parseAgreementsLedger(body: string): AgreementsLedgerParse {
  const items: AgreementItem[] = []
  const diagnostics: string[] = []
  const unparsed: string[] = []
  const seen = new Set<string>()
  for (const [index, raw] of body.split(/\r?\n/).entries()) {
    const line = raw.trim()
    if (line.length === 0) continue
    const match = LINE_RE.exec(line)
    const scope = match?.[1]
    const text = match?.[2]?.trim()
    if (scope !== "global" && scope !== "project" || text === undefined || text.length === 0) {
      diagnostics.push(`line ${index + 1}: expected "- [global|project] <agreement>"`)
      unparsed.push(line)
      continue
    }
    const parsed = parseMeta(match?.[3] ?? "", text, scope)
    if (typeof parsed === "string") {
      diagnostics.push(`line ${index + 1}: ${parsed}`)
      unparsed.push(line)
      continue
    }
    if (seen.has(parsed.id)) {
      diagnostics.push(`line ${index + 1}: duplicate agreement id ${parsed.id}`)
      unparsed.push(line)
      continue
    }
    seen.add(parsed.id)
    items.push(parsed)
  }
  return { items, diagnostics, unparsed }
}

export function serializeAgreementsLedger(items: readonly AgreementItem[], unparsed: readonly string[] = []): string {
  return [...sortAgreements(items).map(serializeItem), ...unparsed].join("\n")
}

export function sortAgreements(items: readonly AgreementItem[]): AgreementItem[] {
  return [...items].sort((a, b) =>
    authorRank(a.by) - authorRank(b.by)
    || (a.since ?? "").localeCompare(b.since ?? "")
    || a.id.localeCompare(b.id))
}

function serializeItem(item: AgreementItem): string {
  const meta = [
    `id: ${item.id}`,
    `by: ${item.by}`,
    `n: ${item.n}`,
    ...(item.since === undefined ? [] : [`since: ${item.since}`]),
    ...(item.last === undefined ? [] : [`last: ${item.last}`]),
    `status: ${item.status}`,
  ]
  return `- [${item.scope}] ${item.text} <!-- ${meta.join("; ")} -->`
}

function authorRank(by: AgreementAuthor): number {
  return by === "human" ? 0 : 1
}

function parseMeta(raw: string, text: string, scope: AgreementScope): AgreementItem | string {
  const fields = new Map<string, string>()
  for (const segment of raw.split(";")) {
    const at = segment.indexOf(":")
    if (segment.trim().length === 0) continue
    if (at <= 0) return `metadata segment "${segment.trim()}" is not key: value`
    fields.set(segment.slice(0, at).trim(), segment.slice(at + 1).trim())
  }
  const id = fields.get("id") ?? agreementId(text)
  if (!ID_RE.test(id)) return `id must be 10 lowercase hex characters`
  const by = fields.get("by") ?? "agent"
  if (by !== "human" && by !== "agent") return `by must be human or agent`
  const n = Number(fields.get("n") ?? "0")
  if (!Number.isSafeInteger(n) || n < 0) return `n must be a non-negative integer`
  const status = fields.get("status") ?? "active"
  if (status !== "active" && status !== "needs-human") return `status must be active or needs-human`
  const since = fields.get("since")
  const last = fields.get("last")
  if (since !== undefined && !DATE_RE.test(since)) return `since must be YYYY-MM-DD`
  if (last !== undefined && !DATE_RE.test(last)) return `last must be YYYY-MM-DD`
  const statusValue: AgreementStatus = status
  return {
    id, scope, by, text, n, status: statusValue,
    ...(since === undefined ? {} : { since }),
    ...(last === undefined ? {} : { last }),
  }
}
