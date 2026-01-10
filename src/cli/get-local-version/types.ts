import type { ReleaseChannel, DistTags } from "../../shared/version"

export interface VersionInfo {
  currentVersion: string | null
  latestVersion: string | null
  isUpToDate: boolean
  isLocalDev: boolean
  isPinned: boolean
  pinnedVersion: string | null
  status: "up-to-date" | "outdated" | "local-dev" | "pinned" | "error" | "unknown"
  // New fields for channel-aware versioning
  currentChannel?: ReleaseChannel
  latestForChannel?: string | null
  updateType?: "major" | "minor" | "patch" | "prerelease" | "none"
  availableChannels?: DistTags
}

export interface GetLocalVersionOptions {
  directory?: string
  json?: boolean
}
