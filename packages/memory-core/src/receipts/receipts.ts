// Append-only, human-readable record of what memory maintenance did: one JSON line per lifecycle event
// in `<runtime>/receipts.jsonl`, outside the memory git repo. Appends serialise under the `receipts`
// lock so concurrent processes never interleave a line; the file is never rotated or truncated.

import { hostname } from "node:os"
import { join } from "node:path"
import { appendFile, chmod, mkdir, readFile } from "../fs/resilient"
import { createLockRecord, receiptsLockPath, withLock } from "../locks"
import { redactSecretLikeMaterial } from "../sync/redact"

export type MemoryReceiptKind = "reflection" | "dream" | "facts"
export type MemoryReceiptEvent =
  | "launched" | "merged" | "no_changes" | "failed" | "abandoned"
  | "quarantined" | "recovered" | "committed" | "no_facts" | "parked"

interface ReceiptBase {
  readonly trigger: string
  readonly event: MemoryReceiptEvent
  readonly sha?: string
  readonly reason?: string
  readonly detail?: string
}

/**
 * A reflection or dream run is identified by its run id plus its generation: `ledger.startedAt`, or the
 * `generation` a pre-ledger sentinel carries. A retired generation and a live one sharing a run id never
 * dedupe against each other. A facts batch id is unique per batch and needs no generation.
 */
export type MemoryReceiptInput =
  | (ReceiptBase & { readonly kind: "reflection" | "dream"; readonly runId: string; readonly generation: string })
  | (ReceiptBase & { readonly kind: "facts"; readonly batchId: string })

export type MemoryReceipt = MemoryReceiptInput & {
  readonly v: 1
  readonly at: string
  readonly host: string
  readonly pid: number
}

export type MemoryReceiptIdentityInput =
  | { readonly kind: "reflection" | "dream"; readonly runId: string; readonly event: MemoryReceiptEvent; readonly generation: string }
  | { readonly kind: "facts"; readonly batchId: string; readonly event: MemoryReceiptEvent }

const RECEIPTS_FILE = "receipts.jsonl"
const DETAIL_LIMIT = 400
const LOCK_WAIT_MS = 30_000

export function receiptsPath(runtimeDir: string): string {
  return join(runtimeDir, RECEIPTS_FILE)
}

/** The key two writers of the same receipt (a live emitter and a later backfill) both compute. */
export function receiptIdentity(receipt: MemoryReceiptIdentityInput): string {
  return receipt.kind === "facts"
    ? JSON.stringify([receipt.kind, receipt.batchId, receipt.event])
    : JSON.stringify([receipt.kind, receipt.runId, receipt.event, receipt.generation])
}

export function appendMemoryReceipt(runtimeDir: string, input: MemoryReceiptInput): Promise<void> {
  return underReceiptsLock(runtimeDir, () => writeLine(runtimeDir, toReceipt(input)))
}

/**
 * Appends unless a receipt with the same identity is already recorded. The check and the append run under
 * one lock acquisition, so racing writers across processes produce exactly one line. Returns whether a
 * line was written.
 */
export function appendMemoryReceiptOnce(runtimeDir: string, input: MemoryReceiptInput): Promise<boolean> {
  return underReceiptsLock(runtimeDir, async () => {
    const identity = receiptIdentity(input)
    const { receipts } = parseReceipts(await readText(runtimeDir))
    if (receipts.some((receipt) => receiptIdentity(receipt) === identity)) return false
    await writeLine(runtimeDir, toReceipt(input))
    return true
  })
}

export interface ReadMemoryReceiptsOptions {
  readonly kind?: MemoryReceiptKind
  readonly limit?: number
}

export interface MemoryReceiptsRead {
  /** Newest first. */
  readonly receipts: readonly MemoryReceipt[]
  readonly skippedPartialLines: number
}

export async function readMemoryReceipts(runtimeDir: string, options: ReadMemoryReceiptsOptions): Promise<MemoryReceiptsRead> {
  const { receipts, skippedPartialLines } = parseReceipts(await readText(runtimeDir))
  const matching = receipts.filter((receipt) => options.kind === undefined || receipt.kind === options.kind).reverse()
  return { receipts: options.limit === undefined ? matching : matching.slice(0, options.limit), skippedPartialLines }
}

async function underReceiptsLock<T>(runtimeDir: string, operation: () => Promise<T>): Promise<T> {
  const locks = join(runtimeDir, "locks")
  await mkdir(locks, { recursive: true })
  return withLock(receiptsLockPath(locks), await createLockRecord("receipts"), operation, { waitTimeoutMs: LOCK_WAIT_MS })
}

function toReceipt(input: MemoryReceiptInput): MemoryReceipt {
  const detail = input.detail === undefined ? undefined : boundDetail(input.detail)
  const reason = input.reason === undefined ? undefined : boundDetail(input.reason)
  return {
    v: 1, at: new Date().toISOString(), ...input,
    ...(reason === undefined ? {} : { reason }), ...(detail === undefined ? {} : { detail }),
    host: hostname(), pid: process.pid,
  }
}

function boundDetail(detail: string): string {
  const masked = redactSecretLikeMaterial(detail)
  return masked.length <= DETAIL_LIMIT ? masked : `${masked.slice(0, DETAIL_LIMIT - 3)}...`
}

async function writeLine(runtimeDir: string, receipt: MemoryReceipt): Promise<void> {
  const path = receiptsPath(runtimeDir)
  await appendFile(path, `${JSON.stringify(receipt)}\n`, { encoding: "utf8", mode: 0o600, flush: true })
  if (process.platform !== "win32") await chmod(path, 0o600)
}

async function readText(runtimeDir: string): Promise<string> {
  try {
    return await readFile(receiptsPath(runtimeDir), "utf8")
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return ""
    throw error
  }
}

function parseReceipts(text: string): { readonly receipts: MemoryReceipt[]; readonly skippedPartialLines: number } {
  const receipts: MemoryReceipt[] = []
  let skippedPartialLines = 0
  for (const line of text.split("\n")) {
    if (line.length === 0) continue
    const receipt = parseReceipt(line)
    if (receipt === null) skippedPartialLines++
    else receipts.push(receipt)
  }
  return { receipts, skippedPartialLines }
}

function parseReceipt(line: string): MemoryReceipt | null {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return null
  }
  if (typeof value !== "object" || value === null) return null
  const candidate = value as Record<string, unknown>
  if (candidate.v !== 1 || typeof candidate.event !== "string" || typeof candidate.at !== "string") return null
  if (candidate.kind === "facts") return typeof candidate.batchId === "string" ? candidate as unknown as MemoryReceipt : null
  if (candidate.kind !== "reflection" && candidate.kind !== "dream") return null
  return typeof candidate.runId === "string" && typeof candidate.generation === "string" ? candidate as unknown as MemoryReceipt : null
}
