import type { ThreadState } from "../contracts/state"
import { createHash } from "node:crypto"

export type RowHold = {
  readonly kind: "session_hold" | "inherited_hold" | "unattended"
  readonly key: string
  readonly since?: string
  readonly queue_depth: number
}

export type RowLiveness =
  | { readonly kind: "running"; readonly activity: "opening" | "running" | "idle" | "parked" }
  | { readonly kind: "held"; readonly hold: RowHold }
  | { readonly kind: "not_running"; readonly evidence: "holder_confirmed" | "unclaimed" | "retired" }
  | { readonly kind: "unknown"; readonly host: string; readonly reason: "host_not_answering" | "identity_refused" }

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)

export function publicHold(value: unknown, depthField: "queueDepth" | "queue_depth"): RowHold | undefined {
  if (!record(value)) return undefined
  const { kind, key, since } = value
  const depth = value[depthField]
  if (kind !== "session_hold" && kind !== "inherited_hold" && kind !== "unattended") return undefined
  const validTime =
    typeof since === "string" &&
    since.length <= 27 &&
    Number.isFinite(Date.parse(since)) &&
    new Date(since).toISOString() === since
  if (typeof depth !== "number" || !Number.isSafeInteger(depth) || depth < 0) return undefined
  const known =
    (kind === "session_hold" && (key === "interrupted-run" || key === "session_hold")) ||
    (kind === "inherited_hold" && key === "inherited_hold") ||
    (kind === "unattended" && (key === "unattended" || key === "host-drain" || key === "closing"))
  return { kind, key: known ? String(key) : "other", ...(validTime ? { since } : {}), queue_depth: depth }
}

/** Never forward an unvalidated wire object, including a future hold's private fields. */
export function remoteLiveness(value: unknown): RowLiveness | undefined {
  if (!record(value)) return undefined
  const { kind, activity, evidence, reason, host } = value
  if (
    kind === "running" &&
    (activity === "opening" || activity === "running" || activity === "idle" || activity === "parked")
  )
    return { kind, activity }
  if (kind === "held") {
    const hold = publicHold(value.hold, "queue_depth")
    if (hold) return { kind, hold }
  }
  if (kind === "not_running" && (evidence === "holder_confirmed" || evidence === "unclaimed" || evidence === "retired"))
    return { kind, evidence }
  if (
    kind === "unknown" &&
    typeof host === "string" &&
    /^[A-Za-z0-9_.:-]{1,128}$/.test(host) &&
    (reason === "host_not_answering" || reason === "identity_refused")
  )
    return { kind, host, reason }
  return undefined
}

export function rowProof(
  legacy: ThreadState,
  proof?: RowLiveness,
): { state: ThreadState; liveness?: RowLiveness; verification?: "unverified"; hold?: RowHold } {
  if (!proof) return { state: legacy, verification: "unverified" as const }
  const state =
    legacy === "archived"
      ? legacy
      : proof.kind === "running"
        ? proof.activity === "parked"
          ? "running"
          : proof.activity
        : proof.kind === "not_running"
          ? "inactive"
          : proof.kind
  return { state, liveness: proof, ...(proof.kind === "held" ? { hold: proof.hold } : {}) }
}

export function claimedRowProof(
  legacy: ThreadState,
  claim: { source_host: string | null; error_note?: string; identity_refusal?: Error; host_unanswered?: boolean },
) {
  if (claim.source_host && (claim.identity_refusal || claim.host_unanswered)) {
    const host = createHash("sha256").update(claim.source_host).digest("hex").slice(0, 16)
    return rowProof(legacy, {
      kind: "unknown",
      host,
      reason: claim.identity_refusal ? "identity_refused" : "host_not_answering",
    })
  }
  return rowProof(legacy, { kind: "not_running", evidence: claim.source_host ? "holder_confirmed" : "unclaimed" })
}

export function engineRowProof(legacy: ThreadState, session: { row_evidence?: RowLiveness }) {
  return rowProof(legacy, session.row_evidence)
}

export function engineEvidence(
  supported: boolean,
  session: { activity?: string; status?: string },
  rawHold: unknown,
): { row_evidence?: RowLiveness } {
  if (!supported) return {}
  if (rawHold !== undefined) {
    const hold = publicHold(rawHold, "queueDepth")
    return hold ? { row_evidence: { kind: "held", hold } } : {}
  }
  if (session.status === "closed") return { row_evidence: { kind: "not_running", evidence: "holder_confirmed" } }
  const activity =
    session.status === "opening"
      ? "opening"
      : ["running", "queued", "awaiting_approval"].includes(session.activity ?? "")
        ? "running"
        : "idle"
  return { row_evidence: { kind: "running", activity } }
}
