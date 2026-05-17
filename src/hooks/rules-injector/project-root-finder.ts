import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { PROJECT_MARKERS } from "./constants";

const projectRootCache = new Map<string, string | null>();

export function clearProjectRootCache(): void {
  projectRootCache.clear();
}

/**
 * Find project root by walking up from startPath.
 * Checks for PROJECT_MARKERS (.git, pyproject.toml, package.json, etc.)
 *
 * Memoizes every directory visited during the walk so subsequent lookups for
 * any descendant path resolve in O(1) without re-running marker existsSync
 * probes.
 *
 * @param startPath - Starting path to search from (file or directory)
 * @returns Project root path or null if not found
 */
export function findProjectRoot(startPath: string): string | null {
  const cached = projectRootCache.get(startPath);
  if (cached !== undefined) {
    return cached;
  }

  const startDir = resolveStartDir(startPath);
  const cachedFromStartDir = projectRootCache.get(startDir);
  if (cachedFromStartDir !== undefined) {
    projectRootCache.set(startPath, cachedFromStartDir);
    return cachedFromStartDir;
  }

  const visited: string[] = [];
  let current = startDir;
  let resolved: string | null = null;

  while (true) {
    const cachedAncestor = projectRootCache.get(current);
    if (cachedAncestor !== undefined) {
      resolved = cachedAncestor;
      break;
    }

    visited.push(current);

    if (hasProjectMarker(current)) {
      resolved = current;
      break;
    }

    const parent = dirname(current);
    if (parent === current) {
      resolved = null;
      break;
    }
    current = parent;
  }

  for (const dir of visited) {
    projectRootCache.set(dir, resolved);
  }
  projectRootCache.set(startPath, resolved);

  return resolved;
}

function resolveStartDir(startPath: string): string {
  try {
    const stat = statSync(startPath);
    return stat.isDirectory() ? startPath : dirname(startPath);
  } catch {
    return dirname(startPath);
  }
}

function hasProjectMarker(dir: string): boolean {
  for (const marker of PROJECT_MARKERS) {
    if (existsSync(join(dir, marker))) {
      return true;
    }
  }
  return false;
}
