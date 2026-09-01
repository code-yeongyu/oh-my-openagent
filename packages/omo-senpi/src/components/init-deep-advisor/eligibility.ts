import { existsSync } from "node:fs"
import { join } from "node:path"

import {
  CHURN_LOC_RATIO_THRESHOLD,
  COMMIT_DISTANCE_THRESHOLD,
  DAYS_SINCE_THRESHOLD,
  TOUCHED_RATIO_THRESHOLD,
} from "./constants"
import { computeCoverageRatio, shouldProposeInit } from "./coverage"
import { computeDrift, shouldProposeRefresh } from "./drift"
import type { DriftMetrics } from "./drift"
import type { EligibilityResult } from "./proposed-data"
import { readSnapshot } from "./state"

export function computeEligibility(
  root: string,
  currentHead: string,
  lastProposedHead: string | null,
  cooldownUntil: number,
): EligibilityResult | null {
  const snapshot = readSnapshot(root)
  if (snapshot.kind === "missing") {
    const coverage = computeCoverageRatio(root)
    if (!shouldProposeInit(coverage?.missingRatio ?? null, existsSync(join(root, "AGENTS.md")))) {
      return null
    }
    if (currentHead === lastProposedHead || Date.now() < cooldownUntil) return null
    return {
      trigger: "coverage-gap",
      coverage: {
        missingRatio: coverage!.missingRatio,
        candidateDirs: coverage!.candidateDirs,
        coveredDirs: coverage!.coveredDirs,
      },
    }
  }
  if (snapshot.kind === "invalid") {
    return staleEligibility(currentHead, lastProposedHead, cooldownUntil)
  }
  const drift = computeDrift(root, snapshot.snapshot)
  if (!shouldProposeRefresh(drift, currentHead, lastProposedHead, cooldownUntil)) return null
  if (drift.kind === "stale") return { trigger: "snapshot-invalid", drift: { stale: true } }
  return driftEligibility(drift)
}

function staleEligibility(
  currentHead: string,
  lastProposedHead: string | null,
  cooldownUntil: number,
): EligibilityResult | null {
  const drift: DriftMetrics = { kind: "stale", stale: true }
  if (!shouldProposeRefresh(drift, currentHead, lastProposedHead, cooldownUntil)) return null
  return { trigger: "snapshot-invalid", drift: { stale: true } }
}

function driftEligibility(drift: Extract<DriftMetrics, { kind: "valid" }>): EligibilityResult {
  const data = {
    commitsSince: drift.commitsSince,
    touchedRatio: drift.touchedRatio,
    churnLocRatio: drift.churnLocRatio,
    daysSince: drift.daysSince,
  }
  if (
    drift.commitsSince >= COMMIT_DISTANCE_THRESHOLD &&
    drift.touchedRatio >= TOUCHED_RATIO_THRESHOLD
  ) {
    return { trigger: "commit-and-touch", drift: data }
  }
  if (drift.churnLocRatio >= CHURN_LOC_RATIO_THRESHOLD) {
    return { trigger: "loc-churn", drift: data }
  }
  if (drift.daysSince >= DAYS_SINCE_THRESHOLD) {
    return { trigger: "snapshot-age", drift: data }
  }
  throw new Error("eligible drift has no trigger")
}
