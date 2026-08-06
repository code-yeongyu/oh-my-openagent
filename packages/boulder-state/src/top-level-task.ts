import { existsSync, readFileSync } from "node:fs"

import { parseCurrentTopLevelTask } from "./plan-checklist"
import type { TopLevelTaskRef } from "./types"

export function readCurrentTopLevelTask(planPath: string): TopLevelTaskRef | null {
  if (!existsSync(planPath)) {
    return null
  }

  try {
    const content = readFileSync(planPath, "utf-8")
    return parseCurrentTopLevelTask(content)
  } catch {
    return null
  }
}
