import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Counts this session's live senpi-task children the same way senpi's builtin herdr reporter does:
 * scanning the project task store (`<cwd>/.omo/senpi-task/tasks/*.json`) for `running`/`pending`
 * records rooted at this session. Kept file-level and injectable because the record store is an
 * external, concurrently-written boundary; unreadable or partial records are skipped and retried
 * on the next poll rather than failing the report.
 */
export interface HerdrTaskCountDeps {
  readonly readdir?: (dir: string) => readonly string[]
  readonly readFile?: (path: string) => string
  readonly debug?: (message: string) => void
}

export function countRunningChildTasks(
  cwd: string,
  sessionId: string | undefined,
  deps: HerdrTaskCountDeps = {},
): number {
  if (sessionId === undefined) return 0
  const directory = join(cwd, ".omo", "senpi-task", "tasks")
  const read = deps.readFile ?? ((path: string) => readFileSync(path, "utf8"))
  let entries: readonly string[]
  try {
    entries = deps.readdir ? deps.readdir(directory) : readdirSync(directory)
  } catch (error) {
    if (!(error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT")) {
      deps.debug?.("Herdr child-task directory unavailable")
    }
    return 0
  }
  let count = 0
  for (const file of entries) {
    if (!file.endsWith(".json")) continue
    try {
      const record: unknown = JSON.parse(read(join(directory, file)))
      if (typeof record !== "object" || record === null) continue
      const status = (record as Record<string, unknown>).status
      if (status !== "running" && status !== "pending") continue
      const owner = record as Record<string, unknown>
      if (owner.root_session_id === sessionId || owner.parent_session_id === sessionId) count++
    } catch {
      deps.debug?.("Herdr ignored an unreadable or partial child-task record")
    }
  }
  return count
}
