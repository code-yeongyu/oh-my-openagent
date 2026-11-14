import type { Task } from "./taskset/tasks.ts"
import type { Cell, CellResult } from "./vocabulary.ts"

/** The contract a module at `drivers/<name>.ts` exports as `driver`; `run.ts --driver <name>` loads it. */
export interface Driver {
  runCell(cell: Cell): Promise<CellResult>
  runTask(task: Task): Promise<{ readonly saved: Readonly<Record<string, unknown>>; readonly cells: number }>
}

export function isDriver(value: unknown): value is Driver {
  return (
    typeof value === "object" &&
    value !== null &&
    "runCell" in value &&
    typeof value.runCell === "function" &&
    "runTask" in value &&
    typeof value.runTask === "function"
  )
}
