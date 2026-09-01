// Structural narrowing for the engine's session_compact rejection payload and the
// extension event context. Everything here is shape-checked at runtime because the
// host surface reaches components as `unknown` (see extension/types.ts).

export interface RejectedRequiredCompaction {
  /** Only required compactions deadlock the session when summarization gives up. */
  reason: "threshold" | "overflow"
  rejectionCause: string
}

export interface RecoveryUsage {
  tokens: number | null
  contextWindow: number
}

export interface RecoveryCompactionSettings {
  enabled?: boolean
  reserveTokens?: number
  keepRecentTokens?: number
}

export interface RecoveryApplyResult {
  applied: boolean
  reason?: string
}

/**
 * Structural port over the parts of the senpi ExtensionContext this component needs.
 * Every member is optional so older hosts degrade to diagnostics-only behavior.
 */
export interface RecoveryEventContext {
  getContextUsage?: () => RecoveryUsage | undefined
  getCompactionSettings?: () => RecoveryCompactionSettings | undefined
  isCompacting?: () => boolean
  applyCompaction?: (
    precomputed: unknown,
    options: { reason: RecoveryEventContextReason },
  ) => Promise<RecoveryApplyResult> | RecoveryApplyResult
  sessionManager?: { getBranch?: () => readonly unknown[] }
}

export type RecoveryEventContextReason = "threshold" | "overflow"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isRequiredReason(value: unknown): value is RejectedRequiredCompaction["reason"] {
  return value === "threshold" || value === "overflow"
}

/**
 * Recognize the #6871 deadlock family: a REQUIRED compaction (threshold/overflow)
 * rejected because the extension route gave up without producing a compaction
 * (`rejectionCause: "cancelled-by-extension"`). Circuit-breaker, per-turn-cap and
 * external-owner cancellations carry their own causes and are deliberately ignored.
 */
export function asRejectedRequiredCompaction(payload: unknown): RejectedRequiredCompaction | undefined {
  if (!isRecord(payload)) return undefined
  if (payload["type"] !== "session_compact") return undefined
  if (payload["accepted"] !== false) return undefined
  if (!isRequiredReason(payload["reason"])) return undefined
  if (payload["rejectionCause"] !== "cancelled-by-extension") return undefined
  return {
    reason: payload["reason"],
    rejectionCause: payload["rejectionCause"],
  }
}

/** Narrow the per-handler event context without importing host runtime types. */
export function extractRecoveryEventContext(ctx: unknown): RecoveryEventContext | undefined {
  if (!isRecord(ctx)) return undefined

  // Each port keeps its ORIGINAL receiver. The host exposes these as object methods, so lifting a
  // bare reference onto this synthetic `ports` object would rebind `this` and make any method that
  // reads host state throw or silently operate on nothing - leaving the deadlock unrecovered.
  const ports: RecoveryEventContext = {}
  const usage = ctx["getContextUsage"]
  if (typeof usage === "function") {
    ports.getContextUsage = usage.bind(ctx) as RecoveryEventContext["getContextUsage"]
  }
  const settings = ctx["getCompactionSettings"]
  if (typeof settings === "function") {
    ports.getCompactionSettings = settings.bind(ctx) as RecoveryEventContext["getCompactionSettings"]
  }
  const compacting = ctx["isCompacting"]
  if (typeof compacting === "function") {
    ports.isCompacting = compacting.bind(ctx) as RecoveryEventContext["isCompacting"]
  }
  const apply = ctx["applyCompaction"]
  if (typeof apply === "function") {
    ports.applyCompaction = apply.bind(ctx) as RecoveryEventContext["applyCompaction"]
  }
  const sessionManager = ctx["sessionManager"]
  if (isRecord(sessionManager) && typeof sessionManager["getBranch"] === "function") {
    const getBranch = sessionManager["getBranch"]
    ports.sessionManager = { getBranch: getBranch.bind(sessionManager) as () => readonly unknown[] }
  }
  return ports
}
