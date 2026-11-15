import type { ActionReport, Verdict } from "./types"

/**
 * The report for an engine that replied `null`: no `action-report` feature, or a `reportMode: "null"` session.
 * It keeps today's meaning (no error means the input was sent); confirming the effect is the caller's read-back.
 */
export function legacyReport(): ActionReport {
  return {
    disposition: { delivery: "delivered_unverified", retry: "unsafe" },
    delivered: null,
    effect: "unverifiable",
    route: null,
    hit: null,
    focusRestoration: "not_confirmed",
    openedSurfaces: [],
    nextCall: null,
    note: null,
    warning: null,
    auditIds: [],
    timings: null,
    legacy: true,
  }
}

/** `confirmed` after a satisfied read-back, `no_change` after an unsatisfied one; `unknown` leaves `effect` as sent. */
export function withVerdict<R extends ActionReport>(report: R, verdict: Verdict): R {
  if (verdict.status === "unknown") return report
  return { ...report, effect: verdict.status === "satisfied" ? "confirmed" : "no_change" }
}
