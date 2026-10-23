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
  readonly targetBackupPath?: string
  readonly targetPath?: string
  readonly transform?: Readonly<Record<string, unknown>>
}

function redactedTransform(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactedTransform)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redactedTransform(entry)]))
  }
  return "[redacted]"
}

function reports(result: ReturnType<typeof runOpenCodeStartupMigration>): readonly MigrationReport[] {
  return result.results.map((entry) => ({
    diagnostics: entry.diagnostics,
    movePlan: entry.preview?.backupMoves ?? [],
    status: entry.status,
    ...(entry.targetBackupPath === undefined ? {} : { targetBackupPath: entry.targetBackupPath }),
    ...(entry.preview === undefined ? {} : {
      targetPath: entry.preview.targetPath,
      transform: redactedTransform(entry.preview.transform) as Readonly<Record<string, unknown>>,
    }),
  }))
}

function printText(report: readonly MigrationReport[], dryRun: boolean, output: (line: string) => void): void {
  const targets = [...new Set(report.flatMap((entry) => entry.targetPath === undefined ? [] : [entry.targetPath]))]
  for (const target of targets) output(`Full values ${dryRun ? "will be written to" : "are in"} ${target}; preview values are redacted.`)
  for (const entry of report) {
    output(`status: ${entry.status}`)
    if (entry.targetPath !== undefined) output(`target: ${entry.targetPath}`)
    if (entry.targetBackupPath !== undefined) output(`backup: ${entry.targetBackupPath}`)
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
    targetBackupPaths: result.targetBackupPaths,
  }

  if (options.json) {
    output(JSON.stringify(response, null, 2))
  } else if (result.error !== undefined) {
    output(`Configuration migration failed: ${result.error}`)
  } else {
    if (result.journalResumed) output("Recovered pending migration journal.")
    if (result.resumedTargetBackupPath !== undefined) output(`backup: ${result.resumedTargetBackupPath}`)
    printText(report, options.dryRun ?? false, output)
    if (report.every((entry) => entry.status === "skipped")) output("Nothing to migrate.")
  }
  return result.error === undefined ? 0 : 1
}
