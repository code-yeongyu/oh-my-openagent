import type { PathClassification } from "./classify-path-environment"

export type FsyncSkipEntry = {
  filePath: string
  contextLabel: string
  errorCode: string
  message: string
  pathClassification: PathClassification
  timestamp: number
}

const MAX_SKIPS = 200
const fsyncSkips: FsyncSkipEntry[] = []

export function recordFsyncSkip(entry: Omit<FsyncSkipEntry, "timestamp">): void {
  fsyncSkips.push({ ...entry, timestamp: Date.now() })

  if (fsyncSkips.length > MAX_SKIPS) {
    fsyncSkips.splice(0, fsyncSkips.length - MAX_SKIPS)
  }
}

export function drainSkipsAfter(timestampMs: number): FsyncSkipEntry[] {
  const drainedEntries: FsyncSkipEntry[] = []
  const retainedEntries: FsyncSkipEntry[] = []

  for (const entry of fsyncSkips) {
    if (entry.timestamp > timestampMs) {
      drainedEntries.push(entry)
      continue
    }

    retainedEntries.push(entry)
  }

  fsyncSkips.splice(0, fsyncSkips.length, ...retainedEntries)
  return drainedEntries
}

export function clearAllSkips(): void {
  fsyncSkips.length = 0
}
