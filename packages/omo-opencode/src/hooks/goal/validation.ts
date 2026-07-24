export const MAX_OBJECTIVE_LENGTH = 4000

const OBJECTIVE_TOO_LONG_HINT =
  "Put longer instructions in a file and reference it in the goal, for example: /goal follow the instructions in docs/goal.md."

export class InvalidObjectiveError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "InvalidObjectiveError"
  }
}

export type ObjectiveCheck =
  | { readonly ok: true; readonly objective: string }
  | { readonly ok: false; readonly error: string }

// Non-throwing objective validator. User-flow call sites (chat message, /goal
// command, goal skill) pre-check with this so an over-limit objective is skipped
// rather than aborting the prompt/command. validateObjective keeps the throwing
// contract for the create_goal/update_goal tools, where the model should see the error.
export function checkObjective(objective: string): ObjectiveCheck {
  const trimmed = objective.trim()

  if (trimmed.length === 0) {
    return { ok: false, error: "Objective cannot be empty" }
  }

  if (trimmed.length > MAX_OBJECTIVE_LENGTH) {
    return {
      ok: false,
      error: `Objective exceeds maximum length of ${MAX_OBJECTIVE_LENGTH} characters. ${OBJECTIVE_TOO_LONG_HINT}`,
    }
  }

  return { ok: true, objective: trimmed }
}

export function validateObjective(objective: string): string {
  const result = checkObjective(objective)
  if (!result.ok) throw new InvalidObjectiveError(result.error)
  return result.objective
}
