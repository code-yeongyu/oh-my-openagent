import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { AGENTS_FILENAME } from "./constants";
import type { AgentsMdCache } from "./types";

export interface FindAgentsMdUpInput {
  readonly startDir: string;
  readonly rootDir: string;
  readonly skipRoot?: boolean;
  readonly unbounded?: boolean;
  readonly cache?: AgentsMdCache;
}

export async function findAgentsMdUp(input: FindAgentsMdUpInput): Promise<string[]> {
  const startDir = resolve(input.startDir);
  const rootDir = resolve(input.rootDir);
  const skipRoot = input.skipRoot ?? true;
  const unbounded = input.unbounded ?? false;
  const cacheKey = [startDir, rootDir, skipRoot ? "1" : "0", unbounded ? "1" : "0"].join("\0");
  const cached = input.cache?.get(cacheKey);
  if (cached) return [...cached];
  const found: string[] = [];
  let current = startDir;
  while (true) {
    const isRootDir = current === rootDir;
    if (!(skipRoot && isRootDir)) {
      const agentsPath = join(current, AGENTS_FILENAME);
      if (isFile(agentsPath)) found.push(agentsPath);
    }
    if (isRootDir) break;
    const parent = dirname(current);
    if (parent === current) break;
    if (!unbounded && !isSameOrChildPath(parent, rootDir)) break;
    current = parent;
  }
  const result = found.reverse();
  input.cache?.set(cacheKey, result);
  return result;
}

function isFile(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isSameOrChildPath(childPath: string, parentPath: string): boolean {
  const relativePath = relative(parentPath, childPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}
