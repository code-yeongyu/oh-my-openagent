export function compareVersions(left: string, right: string): number
export function betaMustFollowLatest(stableVersion: string, currentBeta: string | null | undefined): boolean
export function betaMustFollowLatestFromDistTags(
  stableVersion: string,
  distTagsJson: string | null | undefined,
): boolean | null

export type VerifyBetaAfterMoveResult =
  | { status: "lookup-failed" }
  | { status: "ok" | "ahead"; beta: string }
  | { status: "behind"; beta: string; floor: string; command: string }
export function verifyBetaAfterMove(
  writtenVersion: string,
  beforeDistTagsJson: string | null | undefined,
  afterDistTagsJson: string | null | undefined,
): VerifyBetaAfterMoveResult

export type GuardBetaResult = { status: "ok"; beta: string } | { status: "behind"; beta: string; floor: string | null }
export function guardBetaFromDistTags(distTagsJson: string | null | undefined): GuardBetaResult | null
