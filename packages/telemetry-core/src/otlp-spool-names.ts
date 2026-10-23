import type { Signal } from "./otlp-spool-file"

// The spool's file names and nothing else: the opt-out purge reads only these, so it loads no protobuf code.

export const QUARANTINE_DIR = "quarantine"

export type SpoolEntry =
  | { readonly kind: "active"; readonly name: string; readonly signal: Signal; readonly pid: number; readonly bootId: string }
  | { readonly kind: "batch"; readonly name: string; readonly signal: Signal; readonly batchId: string }
  | {
    readonly kind: "sending"
    readonly name: string
    readonly signal: Signal
    readonly batchId: string
    readonly claimer: string
    readonly leaseExpiresMs: number
  }
  | { readonly kind: "lock"; readonly name: string; readonly target: string }
  | { readonly kind: "other"; readonly name: string }

const ACTIVE = /^active-(logs|traces)-([0-9]+)-([0-9a-f]{32})\.otlp$/
const BATCH = /^batch-(logs|traces)-([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12})\.otlp$/
const SENDING =
  /^batch-(logs|traces)-([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12})\.sending-([0-9a-f]{32})-([0-9]+)$/

const LOCK_SUFFIX = ".lock"

function signalOf(value: string | undefined): Signal {
  return value === "traces" ? "traces" : "logs"
}

export function parseSpoolName(name: string): SpoolEntry {
  const active = ACTIVE.exec(name)
  if (active !== null) {
    return { kind: "active", name, signal: signalOf(active[1]), pid: Number(active[2]), bootId: active[3] ?? "" }
  }
  const batch = BATCH.exec(name)
  if (batch !== null) return { kind: "batch", name, signal: signalOf(batch[1]), batchId: batch[2] ?? "" }
  const sending = SENDING.exec(name)
  if (sending !== null) {
    return {
      kind: "sending",
      name,
      signal: signalOf(sending[1]),
      batchId: sending[2] ?? "",
      claimer: sending[3] ?? "",
      leaseExpiresMs: Number(sending[4]),
    }
  }
  if (name.endsWith(LOCK_SUFFIX)) {
    const target = name.slice(0, -LOCK_SUFFIX.length)
    const kind = parseSpoolName(target).kind
    if (kind !== "other" && kind !== "lock") return { kind: "lock", name, target }
  }
  return { kind: "other", name }
}

/** True only for names the spool itself creates (the builders below); the opt-out purge deletes nothing else. */
export const isSpoolFileName = (name: string): boolean => parseSpoolName(name).kind !== "other"

export const activeName = (signal: Signal, pid: number, bootId: string): string =>
  `active-${signal}-${pid}-${bootId}.otlp`
export const batchName = (signal: Signal, batchId: string): string => `batch-${signal}-${batchId}.otlp`
export const sendingName = (signal: Signal, batchId: string, bootId: string, leaseExpiresMs: number): string =>
  `batch-${signal}-${batchId}.sending-${bootId}-${leaseExpiresMs}`

/** The exclusive move lock of one spool file (see `otlp-spool-lock.ts`). */
export const lockName = (target: string): string => `${target}${LOCK_SUFFIX}`
