const MAX_OBJECTIVE_LENGTH = 2000

export class InvalidObjectiveError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "InvalidObjectiveError"
  }
}

export function validateObjective(objective: string): string {
  const trimmed = objective.trim()

  if (trimmed.length === 0) {
    throw new InvalidObjectiveError("Objective cannot be empty")
  }

  // Truncate instead of throwing so a validation error in a continuation
  // helper can never abort the session (#8409).
  if (trimmed.length > MAX_OBJECTIVE_LENGTH) {
    return trimmed.slice(0, MAX_OBJECTIVE_LENGTH)
  }

  return trimmed
}
