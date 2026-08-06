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

  if (trimmed.length > MAX_OBJECTIVE_LENGTH) {
    throw new InvalidObjectiveError(
      `Objective exceeds maximum length of ${MAX_OBJECTIVE_LENGTH} characters`,
    )
  }

  return trimmed
}
