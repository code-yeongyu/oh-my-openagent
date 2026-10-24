import { lstatSync, readdirSync, rmdirSync, unlinkSync, type Dirent } from "node:fs"
import { join } from "node:path"
import type { TelemetryDiagnosticInput } from "@oh-my-opencode/telemetry-core"

// Releases before the crash-safe session summary (#10225) kept their per-session rollups under
// `<state>/rollups/`. Nothing reads that directory any more and nothing sends from it, so its files are
// data with no reader: every start removes them, whatever the consent, without loading telemetry code.

/** The most entries one start removes; a larger leftover is finished by the next start. */
export const LEGACY_ROLLUP_REMOVE_LIMIT = 1_000

export type LegacyRollupsResult = {
  readonly removed: number
  /** Left on purpose: subdirectories, other entry types, entries past the limit, or a pass stopped because
   * `rollups` stopped being the directory it started on. */
  readonly skipped: number
  /** Files or links whose removal failed. */
  readonly failed: number
}

const NOTHING: LegacyRollupsResult = { removed: 0, skipped: 0, failed: 0 }

const cleaned = new Set<string>()

/** Once per state dir per process: removes the leftovers and logs counts only, never a name or path. */
export function removeLegacyRollupsOnce(stateDir: string, diagnostics?: (input: TelemetryDiagnosticInput) => void): void {
  if (cleaned.has(stateDir)) return
  cleaned.add(stateDir)
  const { removed, failed } = removeLegacyRollups(stateDir)
  if (removed > 0) diagnostics?.({ event: "telemetry_legacy_rollups_removed", source: "omo-native-component", count: removed })
  if (failed > 0) diagnostics?.({ event: "telemetry_activity_state_write_failed", source: "omo-native-component", count: failed })
}

export function legacyRollupDir(stateDir: string): string {
  return join(stateDir, "rollups")
}

/**
 * Removes `<state>/rollups/` without following a link. A `rollups` link is unlinked itself and its target
 * is never read. Inside the directory only files and links are removed (`unlink` never follows), at most
 * `limit` per call; subdirectories are left. Before every removal the path is checked again to still be the
 * same directory (device and inode), so a `rollups` swapped for a link mid-pass stops the pass instead of
 * deleting inside the link's target. The emptied directory is removed last.
 */
export function removeLegacyRollups(stateDir: string, limit: number = LEGACY_ROLLUP_REMOVE_LIMIT): LegacyRollupsResult {
  const dir = legacyRollupDir(stateDir)
  const start = identity(dir)
  if (start === undefined) return NOTHING
  if (start.kind === "link") return unlink(dir) ? { removed: 1, skipped: 0, failed: 0 } : { removed: 0, skipped: 0, failed: 1 }
  if (start.kind !== "directory") return { removed: 0, skipped: 1, failed: 0 }

  const entries = list(dir)
  let removed = 0
  let skipped = 0
  let failed = 0
  for (const [index, entry] of entries.entries()) {
    if (removed >= limit || entry.isDirectory() || !(entry.isFile() || entry.isSymbolicLink())) {
      skipped += 1
      continue
    }
    if (!isSameDirectory(identity(dir), start)) {
      skipped += entries.length - index
      return { removed, skipped, failed }
    }
    if (unlink(join(dir, entry.name))) removed += 1
    else failed += 1
  }
  if (skipped === 0 && failed === 0 && isSameDirectory(identity(dir), start)) {
    try {
      rmdirSync(dir)
    } catch {
      // Another start emptied and removed it first, or a file arrived meanwhile: the next start retries.
    }
  }
  return { removed, skipped, failed }
}

type Identity = { readonly kind: "directory" | "link" | "other"; readonly dev: number; readonly ino: number }

function identity(path: string): Identity | undefined {
  try {
    const stat = lstatSync(path)
    const kind = stat.isSymbolicLink() ? "link" : stat.isDirectory() ? "directory" : "other"
    return { kind, dev: stat.dev, ino: stat.ino }
  } catch {
    return undefined
  }
}

function isSameDirectory(now: Identity | undefined, start: Identity): boolean {
  return now !== undefined && now.kind === "directory" && now.dev === start.dev && now.ino === start.ino
}

function list(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

function unlink(path: string): boolean {
  try {
    unlinkSync(path)
    return true
  } catch {
    return false
  }
}
