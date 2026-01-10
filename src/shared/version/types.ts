/**
 * Version module types
 */

export type ReleaseChannel = "stable" | "beta" | "alpha" | "rc" | "canary" | "dev"

export interface ParsedVersion {
  major: number
  minor: number
  patch: number
  prerelease: string[] // ["beta", "2"] for 3.0.0-beta.2
  build: string[] // ["abc123"] for 3.0.0+abc123
  raw: string
}

export interface DistTags {
  latest: string
  beta?: string
  alpha?: string
  rc?: string
  canary?: string
  next?: string
  [key: string]: string | undefined
}

export interface VersionCheckResult {
  currentVersion: string
  currentChannel: ReleaseChannel
  latestForChannel: string | null
  latestStable: string
  needsUpdate: boolean
  updateType: "major" | "minor" | "patch" | "prerelease" | "none"
  availableChannels: DistTags
}

export interface VersionResolveResult {
  version: string
  source: "runtime" | "cached" | "config-pinned" | "local-dev" | "unknown"
  path?: string
}

export type VersionDiff = "major" | "minor" | "patch" | "prerelease" | "none"
