/** A release version: semver core with an optional dot-separated prerelease, no build metadata. */
export const RELEASE_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?$/

/** Whether `installed` is a release older than `version` (both `RELEASE_VERSION`s); anything else is not older. */
export const olderRuntime = (installed: string, version: string): boolean =>
  RELEASE_VERSION.test(installed) && RELEASE_VERSION.test(version) && Bun.semver.order(installed, version) < 0
