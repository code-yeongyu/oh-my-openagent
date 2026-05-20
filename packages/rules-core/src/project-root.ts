import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { PROJECT_MARKERS } from "./constants";

const projectRootCache = new Map<string, string | null>();

export function clearProjectRootCache(): void {
  projectRootCache.clear();
}

export function findProjectRoot(startPath: string): string | null {
  const cached = projectRootCache.get(startPath);
  if (cached !== undefined) return cached;
  const startDir = resolveStartDir(startPath);
  const cachedStartDir = projectRootCache.get(startDir);
  if (cachedStartDir !== undefined) {
    projectRootCache.set(startPath, cachedStartDir);
    return cachedStartDir;
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
    if (parent === current) break;
    current = parent;
  }

  for (const directory of visited) projectRootCache.set(directory, resolved);
  projectRootCache.set(startPath, resolved);
  return resolved;
}

function resolveStartDir(startPath: string): string {
  try {
    return statSync(startPath).isDirectory() ? startPath : dirname(startPath);
  } catch {
    return dirname(startPath);
  }
}

function hasProjectMarker(directory: string): boolean {
  return PROJECT_MARKERS.some((marker) => existsSync(join(directory, marker)));
}
