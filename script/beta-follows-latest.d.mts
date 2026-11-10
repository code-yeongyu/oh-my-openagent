export function compareVersions(left: string, right: string): number
export function betaMustFollowLatest(stableVersion: string, currentBeta: string | null | undefined): boolean
export function betaMustFollowLatestFromDistTags(stableVersion: string, distTagsJson: string | null | undefined): boolean | null
