type TeamOwnership = {
  readonly teamRunId: string
  readonly role: "lead" | "member"
}

type ContinuationOwnershipInput = {
  readonly callerSessionID: string
  readonly targetSessionID: string
  readonly ownerSessionID?: string
  readonly callerTeam?: TeamOwnership
  readonly targetTeam?: TeamOwnership
}

type ContinuationOwnershipCode =
  | "foreign_owner"
  | "malformed_session_id"
  | "stale_registry"
  | "unknown_lineage"

const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/u

export class ContinuationOwnershipError extends Error {
  readonly name = "ContinuationOwnershipError"

  constructor(readonly code: ContinuationOwnershipCode) {
    super(`Continuation denied: ${code}`)
  }
}

export function assertContinuationOwnership(input: ContinuationOwnershipInput): void {
  if (!SESSION_ID.test(input.callerSessionID) || !SESSION_ID.test(input.targetSessionID)) {
    throw new ContinuationOwnershipError("malformed_session_id")
  }
  if (!input.ownerSessionID) {
    throw new ContinuationOwnershipError("unknown_lineage")
  }
  if (input.ownerSessionID !== input.callerSessionID) {
    throw new ContinuationOwnershipError("foreign_owner")
  }
  if (input.callerTeam || input.targetTeam) {
    if (!input.callerTeam || !input.targetTeam
      || input.callerTeam.role !== "lead"
      || input.callerTeam.teamRunId !== input.targetTeam.teamRunId) {
      throw new ContinuationOwnershipError("stale_registry")
    }
  }
}
