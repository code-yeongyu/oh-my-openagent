/** Every reason a launch is refused before the engine process exists. */
export type EngineLaunchRefusalReason =
  | "engine_unavailable"
  | "quarantined"
  | "no_release_asset"
  | "checksums_unreadable"
  | "no_checksum_entry"
  | "checksum_mismatch"
  | "designated_requirement_mismatch"
  | "unverified_dev_build"
  | "disclaim_unavailable"

/** A launch refused before any spawn: nothing ran, so a caller may report it and retry later. */
export class EngineLaunchRefused extends Error {
  readonly reason: EngineLaunchRefusalReason
  readonly host: string
  readonly detail: string

  constructor(reason: EngineLaunchRefusalReason, host: string, detail: string) {
    super(`omo-computer-engine launch refused (${reason}) on ${host}: ${detail}`)
    this.name = "EngineLaunchRefused"
    this.reason = reason
    this.host = host
    this.detail = detail
  }
}
