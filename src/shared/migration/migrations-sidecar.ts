import * as fs from "node:fs"
import * as path from "node:path"
import { log } from "../logger"
import { writeFileAtomically } from "../write-file-atomically"

/**
 * Sidecar state file that tracks applied config migrations outside the user's
 * config file.
 *
 * Why this exists (#3263): users who revert an auto-migrated value (e.g.
 * `gpt-5.4` → `gpt-5.3-codex`) and then delete the `_migrations` field from
 * their config would fall into an infinite migration loop — every startup
 * re-applied the migration because there was no memory of the previous
 * application. The sidecar remembers applied migrations even when the user
 * scrubs the config, and only "resets" when the user explicitly deletes both
 * the config and the sidecar.
 *
 * The sidecar lives next to the config file as
 * `<configFileName>.migrations.json`. One sidecar per config file. The file
 * format is a flat JSON object:
 *
 *     {
 *       "appliedMigrations": [
 *         "model-version:openai/gpt-5.3-codex->openai/gpt-5.4",
 *         "model-version:anthropic/claude-opus-4-5->anthropic/claude-opus-4-6"
 *       ]
 *     }
 */

export interface MigrationsSidecar {
  appliedMigrations: string[]
}

export function getSidecarPath(configPath: string): string {
  return `${configPath}.migrations.json`
}

/**
 * Read the set of applied migration keys from the sidecar next to
 * `configPath`. Returns an empty set on any read or parse failure so the
 * caller can still trust the return value and safely fall back to the
 * config's `_migrations` field.
 */
export function readAppliedMigrations(configPath: string): Set<string> {
  const sidecarPath = getSidecarPath(configPath)
  try {
    if (!fs.existsSync(sidecarPath)) {
      return new Set()
    }
    const content = fs.readFileSync(sidecarPath, "utf-8")
    const parsed = JSON.parse(content) as unknown
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      Array.isArray((parsed as MigrationsSidecar).appliedMigrations)
    ) {
      return new Set((parsed as MigrationsSidecar).appliedMigrations.filter((m): m is string => typeof m === "string"))
    }
    return new Set()
  } catch (err) {
    log(`[migration] Failed to read migrations sidecar at ${sidecarPath}`, err)
    return new Set()
  }
}

/**
 * Persist the given set of applied migration keys to the sidecar next to
 * `configPath`. The sidecar is written atomically. Returns true on success,
 * false if the write failed (the caller can still proceed — the next
 * startup will re-run the migration, which is idempotent by design).
 */
export function writeAppliedMigrations(configPath: string, migrations: Set<string>): boolean {
  const sidecarPath = getSidecarPath(configPath)
  const body: MigrationsSidecar = {
    appliedMigrations: Array.from(migrations).sort(),
  }
  try {
    // Ensure the parent directory exists in case the config file was created
    // out-of-band. We intentionally do NOT create the sidecar when the migration
    // set is empty — there is nothing to remember.
    const parentDir = path.dirname(sidecarPath)
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true })
    }
    writeFileAtomically(sidecarPath, JSON.stringify(body, null, 2) + "\n")
    return true
  } catch (err) {
    log(`[migration] Failed to write migrations sidecar at ${sidecarPath}`, err)
    return false
  }
}
