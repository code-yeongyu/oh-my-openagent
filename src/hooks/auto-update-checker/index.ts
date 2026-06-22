export { invalidateCache, invalidatePackage } from "./cache"
export { checkForUpdate } from "./checker"
export { createAutoUpdateCheckerHook } from "./hook"
export type { AutoUpdateCheckerOptions, UpdateCheckResult } from "./types"
export {
  extractChannel,
  isDistTag,
  isPrereleaseOrDistTag,
  isPrereleaseVersion,
} from "./version-channel"
