export type SenpiTeamSpecErrorCode =
  | "RESERVED_LEAD_FIELD"
  | "RESERVED_LEAD_MEMBER"
  | "RESERVED_CALLER_TEAM_LEAD"
  | "INVALID_SPEC"
  | "UNRESOLVABLE_CATEGORY"
  | "UNKNOWN_SUBAGENT_TYPE"

/**
 * Raised when a senpi-task team spec cannot be normalized or validated. Carries a typed `code` so
 * callers can distinguish the three reserved-name rejection paths (raw `lead` field, member named
 * `lead`, or a `callerTeamLead` option) from schema and member-vocabulary failures. Every path that
 * throws this error spawns zero members.
 */
export class SenpiTeamSpecError extends Error {
  readonly code: SenpiTeamSpecErrorCode
  readonly teamName: string

  constructor(message: string, code: SenpiTeamSpecErrorCode, teamName: string) {
    super(message)
    this.name = "SenpiTeamSpecError"
    this.code = code
    this.teamName = teamName
  }
}
