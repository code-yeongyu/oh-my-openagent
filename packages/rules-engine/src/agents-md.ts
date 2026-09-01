import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { AGENTS_FILENAME } from "./constants";
import type { AgentsMdCache } from "./types";

export interface FindAgentsMdUpInput {
  readonly startDir: string;
  readonly rootDir: string;
  readonly skipRoot?: boolean;
  readonly cache?: AgentsMdCache;
}

export async function findAgentsMdUp(input: FindAgentsMdUpInput): Promise<string[]> {
  const startDir = canonicalizePath(input.startDir);
  const rootDir = canonicalizePath(input.rootDir);
  const skipRoot = input.skipRoot ?? true;
  if (!isSameOrChildPath(startDir, rootDir)) {
    return [];
  }
  const cacheKey = [startDir, rootDir, skipRoot ? "1" : "0"].join("\0");
  const cached = input.cache?.get(cacheKey);
  if (cached) return [...cached];
  const found: string[] = [];
  let current = startDir;
  while (true) {
    const isRootDir = current === rootDir;
    if (!(skipRoot && isRootDir)) {
      const agentsPath = resolveAgentsFilePath(join(current, AGENTS_FILENAME), rootDir);
      if (agentsPath) found.push(agentsPath);
    }
    if (isRootDir) break;
    const parent = dirname(current);
    if (parent === current || !isSameOrChildPath(parent, rootDir)) break;
    current = parent;
  }
  const result = found.reverse();
  input.cache?.set(cacheKey, result);
  return result;
}

function canonicalizePath(path: string): string {
  try {
    return realpathSync(path);
  } catch (error) {
    if (error instanceof Error) return resolve(path);
    throw error;
  }
}

function resolveAgentsFilePath(path: string, rootDir: string): string | null {
  if (!existsSync(path)) return null;
  try {
    const canonicalPath = realpathSync(path);
    if (!isSameOrChildPath(canonicalPath, rootDir)) return null;
    return statSync(canonicalPath).isFile() ? canonicalPath : null;
  } catch {
    return null;
  }
}

function isSameOrChildPath(childPath: string, parentPath: string): boolean {
  const relativePath = relative(parentPath, childPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}
