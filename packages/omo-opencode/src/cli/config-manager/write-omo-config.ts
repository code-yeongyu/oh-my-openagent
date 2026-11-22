import { existsSync, readFileSync } from "node:fs"

import { resolveUserOmoConfigPath, updateOmoConfig } from "@oh-my-opencode/omo-config-core"

import { parseJsonc } from "../../shared"
import { runOpenCodeStartupMigration } from "../../startup-migration"
import type { ConfigMergeResult, InstallConfig } from "../types"
import { deepMergeRecord } from "./deep-merge-record"
import { formatErrorWithSuggestion } from "./format-error-with-suggestion"
import { generateOmoConfig } from "./generate-omo-config"

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function existingOpenCodeConfig(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {}
  const document = parseJsonc<Record<string, unknown>>(readFileSync(path, "utf-8"))
  return record(document["[opencode]"])
}

export type WriteOmoConfigOptions = {
  /** Line sink for the migration report; defaults to console.log. Tests inject a collector. */
  readonly output?: (line: string) => void
}

export function writeOmoConfig(installConfig: InstallConfig, options: WriteOmoConfigOptions = {}): ConfigMergeResult {
  const output = options.output ?? console.log
  const targetPath = resolveUserOmoConfigPath()
  let writtenPath = targetPath
  try {
    const migration = runOpenCodeStartupMigration({
      afterMigrations: () => {
        const generated = generateOmoConfig(installConfig)
        const merged = deepMergeRecord(generated, existingOpenCodeConfig(targetPath))
        const result = updateOmoConfig({
          edits: [{ path: ["[opencode]"], value: merged }],
          scope: "user",
        })
        writtenPath = result.path
      },
      cwd: process.cwd(),
    })
    if (migration.error !== undefined) {
      return { success: false, configPath: targetPath, error: migration.error }
    }
    if (migration.notImportedKeys.length > 0)
      output(
        `Legacy configuration keys not imported: ${migration.notImportedKeys.join(
          ", ",
        )}. Backup: ${migration.legacyBackupPaths.join(", ")}`,
      )
    return { success: true, configPath: writtenPath }
  } catch (error) {
    return {
      success: false,
      configPath: writtenPath,
      error: formatErrorWithSuggestion(error, "write unified OMO config"),
    }
  }
}
