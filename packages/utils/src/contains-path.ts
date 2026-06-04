import { existsSync, realpathSync } from "fs"
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from "path"

function findNearestExistingAncestor(resolvedPath: string): string {
  let candidatePath = resolvedPath

  while (!existsSync(candidatePath)) {
    const parentPath = dirname(candidatePath)

    if (parentPath === candidatePath) {
      return candidatePath
    }

    candidatePath = parentPath
  }

  return candidatePath
}

function toCanonicalPath(pathToNormalize: string): string {
  const resolvedPath = resolve(pathToNormalize)

  if (existsSync(resolvedPath)) {
    try {
      return normalize(realpathSync.native(resolvedPath))
    } catch {
      return normalize(resolvedPath)
    }
  }

  const nearestExistingAncestor = findNearestExistingAncestor(resolvedPath)
  const canonicalAncestor = existsSync(nearestExistingAncestor)
    ? realpathSync.native(nearestExistingAncestor)
    : nearestExistingAncestor
  const relativePathFromAncestor = relative(nearestExistingAncestor, resolvedPath)

  return normalize(join(canonicalAncestor, relativePathFromAncestor || basename(resolvedPath)))
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
