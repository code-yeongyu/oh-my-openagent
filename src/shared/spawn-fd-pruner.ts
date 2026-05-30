import { closeSync, fstatSync, readdirSync } from "node:fs"

const FD_DIRECTORY = "/dev/fd"
const DEFAULT_PRUNE_THRESHOLD = 8192
const IGNORED_FD_ERROR_CODES = new Set(["EBADF", "EINVAL", "ENOENT"])

type FileDescriptorStats = {
  isDirectory(): boolean
}

export type SpawnFdPrunerDependencies = {
  readonly platform: NodeJS.Platform
  readonly isBunRuntime: boolean
  readonly readdirSync: (path: string) => string[]
  readonly fstatSync: (fd: number) => FileDescriptorStats
  readonly closeSync: (fd: number) => void
}

export type SpawnFdPruneOptions = {
  readonly threshold?: number
}

export type SpawnFdPruneResult = {
  readonly skipped: boolean
  readonly inspectedCount: number
  readonly closedCount: number
}

function parseFileDescriptor(entry: string): number | null {
  const fd = Number(entry)
  if (!Number.isSafeInteger(fd) || fd <= 2) {
    return null
  }

  return fd
}

function isIgnoredFdScanError(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) {
    return false
  }

  const code = error.code
  return typeof code === "string" && IGNORED_FD_ERROR_CODES.has(code)
}

export function pruneLeakedDirectoryFileDescriptors(
  dependencies: SpawnFdPrunerDependencies,
  options: SpawnFdPruneOptions = {},
): SpawnFdPruneResult {
  if (dependencies.platform !== "darwin" || !dependencies.isBunRuntime) {
    return { skipped: true, inspectedCount: 0, closedCount: 0 }
  }

  const entries = dependencies.readdirSync(FD_DIRECTORY)
  if (entries.length < (options.threshold ?? DEFAULT_PRUNE_THRESHOLD)) {
    return { skipped: true, inspectedCount: 0, closedCount: 0 }
  }

  let inspectedCount = 0
  let closedCount = 0
  for (const entry of entries) {
    const fd = parseFileDescriptor(entry)
    if (fd === null) {
      continue
    }

    try {
      inspectedCount += 1
      if (dependencies.fstatSync(fd).isDirectory()) {
        dependencies.closeSync(fd)
        closedCount += 1
      }
    } catch (error) {
      if (isIgnoredFdScanError(error)) {
        continue
      }

      throw error
    }
  }

  return { skipped: false, inspectedCount, closedCount }
}

export function pruneLeakedDirectoryFileDescriptorsBeforeSpawn(): SpawnFdPruneResult {
  return pruneLeakedDirectoryFileDescriptors({
    platform: process.platform,
    isBunRuntime: typeof Bun !== "undefined",
    readdirSync,
    fstatSync,
    closeSync,
  })
}
