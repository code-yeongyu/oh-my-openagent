import { MAX_REFERENCE_CELLS, type Task } from "./tasks.ts"

export interface TaskOutcome {
  readonly saved: Readonly<Record<string, unknown>>
  readonly cells: number
}

/** Why a replayed task fails: a saved-document field that differs from its oracle, or too many reference cells. */
export function taskFailure(task: Task, outcome: TaskOutcome): string | undefined {
  const wrong = task.oracle.filter((expected) => outcome.saved[expected.field] !== expected.equals)
  if (wrong.length > 0) return `saved fields not as declared: ${wrong.map((expected) => expected.field).join(",")}`
  if (outcome.cells > MAX_REFERENCE_CELLS) return `used ${outcome.cells} cells, more than ${MAX_REFERENCE_CELLS}`
  return undefined
}
