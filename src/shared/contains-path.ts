import { existsSync, realpathSync } from "fs"
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from "path"

function toCanonicalPath(pathToNormalize: string): string {
  const resolvedPath = resolve(pathToNormalize)

  if (existsSync(resolvedPath)) {
    try {
      return normalize(realpathSync.native(resolvedPath))
    } catch {
      return normalize(resolvedPath)
    }
  }

  const parentDirectory = dirname(resolvedPath)
  const canonicalParentDirectory = existsSync(parentDirectory)
    ? realpathSync.native(parentDirectory)
    : parentDirectory

  return normalize(join(canonicalParentDirectory, basename(resolvedPath)))
}

export function containsPath(rootPath: string, candidatePath: string): boolean {
  const canonicalRootPath = toCanonicalPath(rootPath)
  const canonicalCandidatePath = toCanonicalPath(candidatePath)
  const relativePath = relative(canonicalRootPath, canonicalCandidatePath)

  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))
}

export function isWithinProject(candidatePath: string, projectRoot: string): boolean {
  return containsPath(projectRoot, candidatePath)
}
