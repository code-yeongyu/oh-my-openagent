import { posix } from "node:path"

import { runOpenCodeStartupMigration } from "../startup-migration"

export type ConfigMigrateOptions = {
  readonly cwd?: string
  readonly dryRun?: boolean
  readonly environment?: Readonly<Record<string, string | undefined>>
  readonly json?: boolean
  readonly output?: (line: string) => void
}

type MigrationReport = {
  readonly diagnostics: readonly string[]
  readonly movePlan: readonly { readonly from: string; readonly to: string }[]
  readonly status: string
  readonly targetPath?: string
  readonly transform?: Readonly<Record<string, unknown>>
}

function reports(result: ReturnType<typeof runOpenCodeStartupMigration>): readonly MigrationReport[] {
  return result.results.map((entry) => ({
    diagnostics: entry.diagnostics,
    movePlan: entry.preview?.backupMoves ?? [],
    status: entry.status,
    ...(entry.preview === undefined ? {} : { targetPath: entry.preview.targetPath, transform: entry.preview.transform }),
  }))
}

function printText(report: readonly MigrationReport[], output: (line: string) => void): void {
  for (const entry of report) {
    output(`status: ${entry.status}`)
    if (entry.targetPath !== undefined) output(`target: ${entry.targetPath}`)
    if (entry.transform !== undefined) output(`transform: ${JSON.stringify(entry.transform, null, 2)}`)
    if (entry.movePlan.length > 0) output(`move-plan: ${JSON.stringify(entry.movePlan, null, 2)}`)
    for (const diagnostic of entry.diagnostics) output(`conflict: ${diagnostic}`)
  }
}

export function runConfigMigrate(options: ConfigMigrateOptions = {}): number {
  const environment = options.environment ?? process.env
  const homeDir = environment["HOME"] ?? environment["USERPROFILE"]
  const output = options.output ?? console.log
  const result = runOpenCodeStartupMigration({
    cwd: options.cwd ?? process.cwd(),
    dryRun: options.dryRun ?? false,
    environment,
    ...(homeDir === undefined ? {} : { env: { HOME: homeDir }, homeDir }),
    pathOperations: posix,
  })
  const report = reports(result)
  const response = {
    dryRun: options.dryRun ?? false,
    error: result.error,
    journalResumed: result.journalResumed,
    migratedFrom: result.migratedFrom,
    migrations: report,
    skippedConflictCount: result.skippedConflictCount,
  }

  if (options.json) {
    output(JSON.stringify(response, null, 2))
  } else if (result.error !== undefined) {
    output(`Configuration migration failed: ${result.error}`)
  } else {
    if (result.journalResumed) output("Recovered pending migration journal.")
    printText(report, output)
    if (report.every((entry) => entry.status === "skipped")) output("Nothing to migrate.")
  }
  return result.error === undefined ? 0 : 1
}
