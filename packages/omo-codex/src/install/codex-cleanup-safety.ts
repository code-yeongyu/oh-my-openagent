import { dirname, isAbsolute, join, relative, resolve } from "node:path"

export interface SkippedCleanupPath {
  readonly path: string
  readonly reason: "outside managed Codex cleanup scope" | "Codex home resolves to a filesystem root"
}

// A Codex home at the filesystem root would make every derived managed path resolve to a
// shared system directory, so cleanup refuses to act on it. Exported so callers that derive
// their own paths from codexHome (the installer bin directory) share this one invariant.
export function codexHomeResolvesToFilesystemRoot(codexHome: string): boolean {
  const resolved = resolve(codexHome)
  return dirname(resolved) === resolved
}

export function validateManagedCleanupTarget(input: {
  readonly codexHome: string
  readonly path: string
}): SkippedCleanupPath | null {
  if (!isAbsolute(input.path)) return skipped(input.path, "outside managed Codex cleanup scope")

  const codexHome = resolve(input.codexHome)
  if (codexHomeResolvesToFilesystemRoot(codexHome)) return skipped(input.path, "Codex home resolves to a filesystem root")

  const target = resolve(input.path)
  if (!isWithinDirectory(codexHome, target)) return skipped(input.path, "outside managed Codex cleanup scope")
  if (target === codexHome) return skipped(input.path, "outside managed Codex cleanup scope")

  const exactManagedRoots = new Set([
    resolve(join(codexHome, "plugins", "cache", "sisyphuslabs")),
    resolve(join(codexHome, ".tmp", "marketplaces", "sisyphuslabs")),
    resolve(join(codexHome, "runtime", "ast-grep")),
    resolve(join(codexHome, "runtime", "node")),
    resolve(join(codexHome, "plugins", "data", "omo-sisyphuslabs", "bootstrap")),
  ])
  if (exactManagedRoots.has(target)) return null
  if (isManagedBootstrapDriftPath(codexHome, target)) return null

  return skipped(input.path, "outside managed Codex cleanup scope")
}

function isWithinDirectory(parent: string, child: string): boolean {
  const relativePath = relative(parent, child)
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))
}

function isManagedBootstrapDriftPath(codexHome: string, target: string): boolean {
  const relativePath = relative(codexHome, target)
  const segments = relativePath.split(/[\\/]/)
  if (segments[0] !== "plugins") return false
  if (segments[segments.length - 1] !== "bootstrap") return false
  const ownerName = segments[segments.length - 2]
  return ownerName !== undefined && ownerName.startsWith("omo") && ownerName.slice("omo".length).includes("sisyphuslabs")
}

function skipped(path: string, reason: SkippedCleanupPath["reason"]): SkippedCleanupPath {
  return { path, reason }
}
