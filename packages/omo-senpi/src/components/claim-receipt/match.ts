import type { Claim, ClaimKind } from "./classify"
import type { CheckEvidence, CheckKind, CheckOutcome, EditEvidence, Timeline } from "./evidence"

export type ClaimStatus = "supported" | "unsupported" | "unknown" | "admitted"
export type UnsupportedReason = "no-check" | "last-check-failed" | "stale-after-edit"

export interface ClaimVerdict {
  readonly claim: Claim
  readonly status: ClaimStatus
  readonly reason?: UnsupportedReason
  readonly receipt?: { readonly entryId: string; readonly kind: CheckKind; readonly outcome: CheckOutcome }
  readonly invalidatedBy?: { readonly entryId: string; readonly paths: readonly string[] }
}

const ANY_CHECK: ReadonlySet<CheckKind> = new Set(["test", "typecheck", "lint", "build", "run", "lsp"])
const SUPPORTED_BY: Readonly<Record<ClaimKind, ReadonlySet<CheckKind>>> = {
  test: new Set(["test"]),
  typecheck: new Set(["typecheck", "lsp"]),
  lint: new Set(["lint"]),
  build: new Set(["build"]),
  run: new Set(["run", "test", "build"]),
  exists: new Set([...ANY_CHECK, "lookup"]),
  done: ANY_CHECK,
}
const NEEDS_A_CODE_EDIT: ReadonlySet<ClaimKind> = new Set(["done", "run"])

const receiptOf = (check: CheckEvidence) => ({ entryId: check.entryId, kind: check.kind, outcome: check.outcome })
const latest = <T extends { readonly at: number }>(items: readonly T[]): T | undefined =>
  items.reduce<T | undefined>((best, item) => (best === undefined || item.at >= best.at ? item : best), undefined)

function judge(claim: Claim, checks: readonly CheckEvidence[], edits: readonly EditEvidence[]): ClaimVerdict {
  if (claim.admitted) return { claim, status: "admitted" }
  if (NEEDS_A_CODE_EDIT.has(claim.kind) && !edits.some((edit) => edit.relevant)) return { claim, status: "unknown" }
  const supporting = SUPPORTED_BY[claim.kind]
  const candidates = checks.filter((check) => supporting.has(check.kind))
  if (claim.kind === "exists") return judgeExists(claim, candidates, checks.length)
  const last = latest(candidates)
  if (last === undefined) {
    // Check runs of other kinds mean verification happened somewhere this session cannot see (remote runners, CI);
    // only a session with no check run at all, or a claim that quotes no observed result, is flagged. A lookup
    // (reading or searching a file) is never a check run: it proves only that something exists.
    const ranAnyCheck = checks.some((check) => check.kind !== "lookup")
    if (claim.reported || ranAnyCheck) return { claim, status: "unknown" }
    return { claim, status: "unsupported", reason: "no-check" }
  }
  // A later check whose outcome is unknown cannot erase a failure that was visible before it, unless the claim
  // quotes concrete numbers, which most likely come from that later run's output the timeline could not read.
  const decisive = latest(candidates.filter((check) => check.outcome !== "unknown"))
  const quotesLaterRun = claim.reported && last.outcome === "unknown"
  if (decisive?.outcome === "failed" && !quotesLaterRun) return { claim, status: "unsupported", reason: "last-check-failed", receipt: receiptOf(decisive) }
  if (last.outcome === "unknown") return { claim, status: "unknown", receipt: receiptOf(last) }
  const stale = latest(edits.filter((edit) => edit.relevant && edit.at > last.at))
  if (stale !== undefined) {
    return { claim, status: "unsupported", reason: "stale-after-edit", receipt: receiptOf(last), invalidatedBy: { entryId: stale.entryId, paths: stale.paths } }
  }
  return { claim, status: "supported", receipt: receiptOf(last) }
}

// Existence is proven by looking (read, grep, symbol lookups) or by any passing check; a failing check of an
// unrelated kind says nothing about whether something exists, so it never flags the claim.
function judgeExists(claim: Claim, candidates: readonly CheckEvidence[], checkCount: number): ClaimVerdict {
  const proof = latest(candidates.filter((check) => check.outcome === "passed"))
  if (proof !== undefined) return { claim, status: "supported", receipt: receiptOf(proof) }
  if (claim.reported || checkCount > 0) return { claim, status: "unknown" }
  return { claim, status: "unsupported", reason: "no-check" }
}

/** Evaluates each claim at the answer's branch position: evidence at or after `answerAt` is never consulted. */
export function matchClaims(timeline: Timeline, claims: readonly Claim[], answerAt: number): ClaimVerdict[] {
  const checks = timeline.checks.filter((check) => check.at < answerAt)
  const edits = timeline.edits.filter((edit) => edit.at < answerAt)
  return claims.map((claim) => judge(claim, checks, edits))
}

export const isFlagged = (verdict: ClaimVerdict): boolean => verdict.status === "unsupported"
