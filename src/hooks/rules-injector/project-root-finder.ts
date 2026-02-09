import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { PROJECT_MARKERS } from "./constants";

/**
 * Find project root by walking up from startPath.
 * Checks for PROJECT_MARKERS (.git, pyproject.toml, package.json, etc.)
 *
 * @param startPath - Starting path to search from (file or directory)
 * @returns Project root path or null if not found
 */
export function findProjectRoot(startPath: string): string | null {
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
