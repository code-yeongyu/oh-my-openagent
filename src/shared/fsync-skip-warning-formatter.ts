import { describePathClassification } from "./classify-path-environment"
import type { FsyncSkipEntry } from "./fsync-skip-tracker"

const MAX_PATH_LINES = 5

function selectMostCommonClassification(
  entries: FsyncSkipEntry[],
): FsyncSkipEntry["pathClassification"] {
  const counts = new Map<FsyncSkipEntry["pathClassification"], number>()

  for (const entry of entries) {
    const currentCount = counts.get(entry.pathClassification) ?? 0
    counts.set(entry.pathClassification, currentCount + 1)
  }

  let selected: FsyncSkipEntry["pathClassification"] = "unknown"
  let selectedCount = -1
  for (const [classification, count] of counts.entries()) {
    if (count > selectedCount) {
      selected = classification
      selectedCount = count
    }
  }

  return selected
}

export function formatFsyncSkipWarning(entries: FsyncSkipEntry[]): string {
  if (entries.length === 0) return ""

  const selectedClassification = selectMostCommonClassification(entries)
  const selectedDescription = describePathClassification(selectedClassification)
  const shownEntries = entries.slice(0, MAX_PATH_LINES)
  const hiddenCount = Math.max(entries.length - shownEntries.length, 0)
  const pathLines = shownEntries.map((entry) => `  - ${entry.filePath} (code: ${entry.errorCode})`)
  if (hiddenCount > 0) {
    pathLines.push(`  ... and ${hiddenCount} more`)
  }

  const environmentLines = selectedClassification === "unknown"
    ? []
    : [`Detected environment: ${selectedDescription}`]

  const durabilityLine = selectedClassification === "unknown"
    ? "  - Crash durability is best-effort because this filesystem does not support fsync."
    : "  - Crash durability is best-effort on this filesystem (this is normal for iCloud, OneDrive, network drives, antivirus-locked paths)."

  return [
    "---",
    `[fsync-skipped] ${entries.length} write(s) bypassed fsync because the underlying filesystem rejected the syscall.`,
    "",
    ...environmentLines,
    "Affected paths:",
    ...pathLines,
    "",
    "What this means:",
    "  - The write+rename succeeded — the file is on disk, atomicity is preserved.",
    durabilityLine,
    "  - No action required. Operation completed successfully.",
  ].join("\n")
}
