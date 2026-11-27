import type { ThreadState } from "../contracts/state"
import { createHash } from "node:crypto"

/** Relay v8's closed mirror of the engine's SESSION_ROW_HOLD_KEYS, never an arbitrary ledger key. */
const PUBLIC_KEYS = {
  session_hold: ["interrupted-run", "session_hold"],
  inherited_hold: ["inherited_hold"],
  unattended: ["unattended", "closing", "host-drain"],
} as const
type HoldKind = keyof typeof PUBLIC_KEYS
type HoldKey = (typeof PUBLIC_KEYS)[HoldKind][number] | "other"
export type RowHold = {
  readonly kind: HoldKind
  readonly key: HoldKey
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

export function holdFamily(value: unknown): { kind: HoldKind; key: HoldKey } | undefined {
  if (!record(value)) return undefined
  const { kind, key } = value
  if (kind !== "session_hold" && kind !== "inherited_hold" && kind !== "unattended") return undefined
  const family =
    kind === "session_hold" && typeof key === "string" && /^session_hold:[0-9]{1,16}$/.test(key) ? "session_hold" : key
  return { kind, key: PUBLIC_KEYS[kind].find((v) => v === family) ?? "other" }
}

export function publicHold(value: unknown, depthField: "queueDepth" | "queue_depth"): RowHold | undefined {
  if (!record(value)) return undefined
  const { since } = value
  const depth = value[depthField]
  const family = holdFamily(value)
  if (!family) return undefined
  const validTime =
    typeof since === "string" &&
    since.length <= 27 &&
    Number.isFinite(Date.parse(since)) &&
    new Date(since).toISOString() === since
  if (typeof depth !== "number" || !Number.isSafeInteger(depth) || depth < 0) return undefined
  return { ...family, ...(validTime ? { since } : {}), queue_depth: depth }
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
