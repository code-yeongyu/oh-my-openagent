import { resolveProjectStateDirectory } from "./project-state-directory"
import type { StateDirConfig } from "./types"

export function resolveStateDir(config: StateDirConfig): string {
  return config.task?.state_dir ?? resolveProjectStateDirectory(config.project_dir, "senpi-task")
}
