import {
  CHURN_LOC_RATIO_THRESHOLD,
  COMMIT_DISTANCE_THRESHOLD,
  DAYS_SINCE_THRESHOLD,
  MS_PER_DAY,
  TOUCHED_RATIO_THRESHOLD,
} from "./constants"
import {
  gitChurnLoc,
  gitCommitsSince,
  gitObjectType,
  gitTotalLoc,
  gitTouchedFilesSince,
  gitTrackedFileCount,
} from "./git-helpers"
import type { InitDeepSnapshotV1 } from "./state"

export type DriftMetrics =
  | {
      kind: "valid"
      commitsSince: number
      touchedFiles: number
      trackedFiles: number
      touchedRatio: number
      churnLoc: number
      totalLoc: number
      churnLocRatio: number
      daysSince: number
    }
  | { kind: "stale"; stale: true }

export function computeDrift(root: string, snapshot: InitDeepSnapshotV1): DriftMetrics {
  if (gitObjectType(root, snapshot.commitSha) !== "commit") {
    return { kind: "stale", stale: true }
  }
  const commitsSince = gitCommitsSince(root, snapshot.commitSha)
  const touchedFiles = gitTouchedFilesSince(root, snapshot.commitSha).length
  const trackedFiles = gitTrackedFileCount(root)
  const churnLoc = gitChurnLoc(root, snapshot.commitSha)
  const totalLoc = gitTotalLoc(root)
  return {
    kind: "valid",
    commitsSince,
    touchedFiles,
    trackedFiles,
    touchedRatio: touchedFiles / Math.max(trackedFiles, 1),
    churnLoc,
    totalLoc,
    churnLocRatio: churnLoc / Math.max(totalLoc, 1),
    daysSince: (Date.now() - snapshot.timestamp) / MS_PER_DAY,
  }
}

export function shouldProposeRefresh(
  drift: DriftMetrics,
  currentHead: string,
  lastProposedHead: string | null,
  cooldownUntil: number,
): boolean {
  if (currentHead === lastProposedHead) return false
  if (Date.now() < cooldownUntil) return false
  if (drift.kind === "stale") return true
  return (
    (drift.commitsSince >= COMMIT_DISTANCE_THRESHOLD &&
      drift.touchedRatio >= TOUCHED_RATIO_THRESHOLD) ||
    drift.churnLocRatio >= CHURN_LOC_RATIO_THRESHOLD ||
    drift.daysSince >= DAYS_SINCE_THRESHOLD
  )
}
