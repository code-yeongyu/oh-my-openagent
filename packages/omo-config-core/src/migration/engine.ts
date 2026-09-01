import { runMigrations } from "./batch"
import type { MigrationRunResult, RunMigrationOptions } from "./types"

export function runMigration(options: RunMigrationOptions): MigrationRunResult {
  const result = runMigrations({
    ...options,
    discover: () => [{
      id: options.id,
      ...(options.mode === undefined ? {} : { mode: options.mode }),
      sources: options.sources,
      targetPath: options.targetPath,
      transform: options.transform,
    }],
  })
  if (result.status === "locked") return { diagnostics: [], journalResumed: false, status: "locked" }
  return result.results[0] ?? { diagnostics: [], journalResumed: result.journalResumed, status: "skipped" }
}
