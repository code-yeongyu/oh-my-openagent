// Capture receipts (review r4 HIGH): a capture's identity is (device peer, item, baseline
// frontier). The receipt for that identity records the working text already applied and the
// frontier the capture produced. A later capture with the same identity diffs from the
// receipt's text at the receipt's frontier instead of from the baseline, so an edit applied
// under an identity is never applied again, whatever the user typed since.
// `seen` lists the register and set map tags present in the user's view of that text: a later
// capture at the same identity never supersedes or deletes any other tag (review r5 M2). A
// materialized write or a no-op capture sees everything the doc held.
// Receipts are per-device state (the device's state dir, never a synced root). One is trusted
// only when the document holds its frontier ops with the recorded Lamport stamps and, for a
// receipt of a capture that wrote ops, that very capture: `span` is the device's counter range
// and the capture id the capture committed as its change message, which Loro keeps on the
// change everywhere it travels (review r5 L1; op JSON is not stable, Loro re-merges adjacent
// ops). A receipt for an update that was never imported (crash before import) is ignored and
// the baseline diff applies, even when another capture later filled the same counters.
// Each item keeps the newest MAX_RECEIPTS baselines; the engine has at most two in flight.

import { createHash, randomBytes } from "node:crypto"
import { join } from "node:path"

import type { LoroDoc, PeerID } from "../../crdt/loro-runtime"
import { mkdir, readFile, rename, writeFile } from "../../fs/resilient"

import type { ItemFrontier } from "./document"

export interface CaptureReceipt {
  readonly base: ItemFrontier
  readonly text: string
  readonly at: ItemFrontier
  readonly stamps: readonly number[]
  readonly seen: readonly string[]
  readonly span: OpSpan | null
}

export interface OpSpan {
  readonly peer: PeerID
  readonly start: number
  readonly end: number
  readonly captureId: string
}

export const MAX_RECEIPTS = 32

function receiptPath(stateDir: string, itemKey: string): string {
  return join(stateDir, "captures", `${createHash("sha256").update(itemKey).digest("hex")}.json`)
}

export async function readReceipts(stateDir: string, itemKey: string): Promise<CaptureReceipt[]> {
  let raw: string
  try {
    raw = await readFile(receiptPath(stateDir, itemKey), "utf8")
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return []
    throw error
  }
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed)) throw new TypeError(`capture receipts are not a list: ${itemKey}`)
  return parsed.map((entry) => asReceipt(entry, itemKey))
}

export async function writeReceipts(stateDir: string, itemKey: string, receipts: readonly CaptureReceipt[]): Promise<void> {
  const path = receiptPath(stateDir, itemKey)
  await mkdir(join(stateDir, "captures"), { recursive: true })
  const temp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`
  await writeFile(temp, JSON.stringify(receipts.slice(-MAX_RECEIPTS)), { flag: "wx", mode: 0o600 })
  await rename(temp, path)
}

export function sameFrontier(a: ItemFrontier, b: ItemFrontier): boolean {
  return a.length === b.length && a.every((x) => b.some((y) => x.peer === y.peer && x.counter === y.counter))
}

export function stampsOf(doc: LoroDoc, frontier: ItemFrontier): number[] {
  return frontier.map((id) => {
    const change = doc.getChangeAt(id)
    return change.lamport + (id.counter - change.counter)
  })
}

export function receiptLanded(doc: LoroDoc, receipt: CaptureReceipt): boolean {
  const version = doc.oplogVersion().toJSON()
  if (!receipt.at.every(({ peer, counter }) => (version.get(peer) ?? 0) > counter)) return false
  const stamps = stampsOf(doc, receipt.at)
  if (stamps.length !== receipt.stamps.length || !stamps.every((stamp, i) => stamp === receipt.stamps[i])) return false
  const span = receipt.span
  if (span === null) return true
  if ((version.get(span.peer) ?? 0) < span.end) return false
  const change = doc.getChangeAt({ peer: span.peer, counter: span.start })
  return change.counter === span.start && change.message === captureMessage(span.captureId)
}

export function captureMessage(captureId: string): string {
  return `omo-capture:${captureId}`
}

function asReceipt(entry: unknown, itemKey: string): CaptureReceipt {
  if (typeof entry === "object" && entry !== null && "base" in entry && "text" in entry && "at" in entry && "stamps" in entry && "seen" in entry && "span" in entry) {
    const { base, text, at, stamps, seen, span } = entry
    if (typeof text === "string" && isFrontier(base) && isFrontier(at) && isStamps(stamps) && isTags(seen) && (span === null || isSpan(span))) {
      return { base, text, at, stamps, seen, span }
    }
  }
  throw new TypeError(`malformed capture receipt: ${itemKey}`)
}

function isTags(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((tag: unknown) => typeof tag === "string")
}

function isSpan(value: unknown): value is OpSpan {
  if (typeof value !== "object" || value === null) return false
  if (!("peer" in value) || !("start" in value) || !("end" in value) || !("captureId" in value)) return false
  return typeof value.peer === "string" && /^[0-9]+$/.test(value.peer) && typeof value.start === "number" && typeof value.end === "number" && typeof value.captureId === "string"
}

function isStamps(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((stamp: unknown) => typeof stamp === "number")
}

function isFrontier(value: unknown): value is ItemFrontier {
  return (
    Array.isArray(value) &&
    value.every(
      (id: unknown) =>
        typeof id === "object" &&
        id !== null &&
        "peer" in id &&
        "counter" in id &&
        typeof id.peer === "string" &&
        /^[0-9]+$/.test(id.peer) &&
        typeof id.counter === "number",
    )
  )
}
