import { join } from "node:path"

import type { StateDirConfig } from "./types"

export function resolveStateDir(config: StateDirConfig): string {
  return config.task?.state_dir ?? join(config.project_dir, ".omo", "senpi-task")
}
