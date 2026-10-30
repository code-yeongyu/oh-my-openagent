import { rmSync } from "node:fs"
import type { OmoBinEntry } from "./legacy-omo-bin"

export interface LegacyOmoBinRemoval {
  readonly binPath: string
  readonly packageName: string
  readonly packageVersion: string | null
}

export interface LegacyOmoBinRepairFailure {
  readonly binPath: string
  readonly reason: string
}

export interface LegacyOmoBinRepair {
  readonly removed: readonly LegacyOmoBinRemoval[]
  readonly failures: readonly LegacyOmoBinRepairFailure[]
  readonly notes: readonly string[]
  readonly warnings: readonly string[]
}

export function describePackage(entry: OmoBinEntry): string {
  const name = entry.packageName ?? "an unknown package"
  return entry.packageVersion === null ? name : `${name}@${entry.packageVersion}`
}

export function removeFileCommand(binPath: string, isWindows: boolean): string {
  return isWindows ? `del "${binPath}"` : `rm "${binPath}"`
}

/**
 * Removes only the `omo` command that a pre-rename release left behind. The package that owns it, and
 * every other command it installs, stay in place: the rename orphaned this one alias, and uninstalling
 * somebody's whole global package to install ours is not a decision an installer gets to make.
 */
export function repairLegacyOmoBins(
  entries: readonly OmoBinEntry[],
  options: { readonly isWindows: boolean },
): LegacyOmoBinRepair {
  const removed: LegacyOmoBinRemoval[] = []
  const failures: LegacyOmoBinRepairFailure[] = []
  const notes: string[] = []
  const warnings: string[] = []

  for (const entry of entries) {
    const owner = describePackage(entry)
    try {
      for (const shimPath of entry.shimPaths) rmSync(shimPath)
      removed.push({
        binPath: entry.binPath,
        packageName: entry.packageName ?? "",
        packageVersion: entry.packageVersion,
      })
      notes.push(
        `Removed the stale omo command left by ${owner} (${entry.binPath}). That package and its other commands are untouched; reinstalling it would put its omo back in front of omo-ai.`,
      )
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      failures.push({ binPath: entry.binPath, reason })
      warnings.push(
        `Could not remove the stale omo command owned by ${owner} (${entry.binPath}): ${reason}. Remove it yourself with ${removeFileCommand(entry.binPath, options.isWindows)}, or drop the whole package with npm uninstall -g ${entry.packageName ?? "oh-my-openagent"}.`,
      )
    }
  }

  return { removed, failures, notes, warnings }
}
