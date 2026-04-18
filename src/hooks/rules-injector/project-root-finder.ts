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
 * @param startPath - Starting path to search from (file or directory)
 * @returns Project root path or null if not found
 */
export function findProjectRoot(startPath: string): string | null {
  if (projectRootCache.has(startPath)) {
    return projectRootCache.get(startPath) ?? null;
  }

  const projectRoot = findProjectRootWithoutCache(startPath);
  projectRootCache.set(startPath, projectRoot);
  return projectRoot;
}

function findProjectRootWithoutCache(startPath: string): string | null {
  let current: string;

  try {
    const stat = statSync(startPath);
    current = stat.isDirectory() ? startPath : dirname(startPath);
  } catch {
    current = dirname(startPath);
  }

  while (true) {
    for (const marker of PROJECT_MARKERS) {
      const markerPath = join(current, marker);
      if (existsSync(markerPath)) {
        return current;
      }
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}
