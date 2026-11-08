import {
  appendMemoryReceiptOnce,
  type MemoryReceiptEvent,
  type MemoryReceiptInput,
  type ReflectionOutcome,
} from "@oh-my-opencode/memory-core"

export interface MemoryReceiptsPort {
  append(runtimeDir: string, input: MemoryReceiptInput): Promise<boolean>
}

export const DEFAULT_RECEIPTS_PORT: MemoryReceiptsPort = { append: appendMemoryReceiptOnce }

export type ReceiptWarn = (message: string, fields: Readonly<Record<string, unknown>>) => void

export interface RunReceiptLedger {
  readonly kind: "reflection" | "dream"
  readonly runId: string
  readonly trigger: string
  readonly origin?: string
  readonly startedAt: string
}

interface ReceiptExtra {
  readonly sha?: string
  readonly reason?: string
  readonly detail?: string
}

/**
 * Writes one receipt after the durable artifact it describes. The artifact is the source of truth and
 * the receipt is the readable view, so a failed write is reported and never fails the run.
 */
export async function emitMemoryReceipt(
  runtimeDir: string,
  input: MemoryReceiptInput,
  port: MemoryReceiptsPort = DEFAULT_RECEIPTS_PORT,
  warn?: ReceiptWarn,
): Promise<void> {
  try {
    await port.append(runtimeDir, input)
  } catch (error) {
    warn?.("memory receipt write failed; the run's own artifact still records its outcome", {
      kind: input.kind,
      event: input.event,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/** Generation is `ledger.startedAt`, the one value both a live emitter and a later backfill can read. */
export function runReceipt(ledger: RunReceiptLedger, event: MemoryReceiptEvent, extra: ReceiptExtra = {}): MemoryReceiptInput {
  return {
    kind: ledger.kind,
    runId: ledger.runId,
    trigger: ledger.origin ?? ledger.trigger,
    event,
    generation: ledger.startedAt,
    ...defined(extra),
  }
}

export function runOutcomeReceipt(
  ledger: RunReceiptLedger,
  outcome: ReflectionOutcome,
  extra: { readonly integrationSha?: string; readonly reason?: string; readonly detail?: string },
): MemoryReceiptInput {
  if (outcome === "merged") return runReceipt(ledger, "merged", { sha: extra.integrationSha, detail: extra.detail })
  if (outcome === "no_changes") return runReceipt(ledger, "no_changes", { detail: extra.detail })
  return runReceipt(ledger, "failed", { reason: extra.reason ?? outcome, detail: extra.detail })
}

export function factsReceipt(batchId: string, event: MemoryReceiptEvent, extra: ReceiptExtra = {}): MemoryReceiptInput {
  return { kind: "facts", batchId, trigger: "settle", event, ...defined(extra) }
}

function defined(extra: ReceiptExtra): ReceiptExtra {
  return {
    ...(extra.sha === undefined ? {} : { sha: extra.sha }),
    ...(extra.reason === undefined ? {} : { reason: extra.reason }),
    ...(extra.detail === undefined ? {} : { detail: extra.detail }),
  }
}
