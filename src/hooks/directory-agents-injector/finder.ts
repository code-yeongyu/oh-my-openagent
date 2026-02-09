import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { AGENTS_FILENAME } from "./constants";

export function resolveFilePath(rootDirectory: string, path: string): string | null {
  if (!path) return null;
  if (path.startsWith("/")) return path;
  return resolve(rootDirectory, path);
}

export function findAgentsMdUp(input: {
  startDir: string;
  rootDir: string;
}): string[] {
  const found: string[] = [];
  let current = input.startDir;

  while (true) {
    // Skip root AGENTS.md - OpenCode's system.ts already loads it via custom()
    // See: https://github.com/code-yeongyu/oh-my-opencode/issues/379
    const isRootDir = current === input.rootDir;
    if (!isRootDir) {
      const agentsPath = join(current, AGENTS_FILENAME);
      if (existsSync(agentsPath)) {
        found.push(agentsPath);
      }
    }

    if (isRootDir) break;
    const parent = dirname(current);
    if (parent === current) break;
    if (!parent.startsWith(input.rootDir)) break;
    current = parent;
  }

  return found.reverse();
}
