import { constants, promises as fsPromises } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { AGENTS_FILENAME } from "./constants";

export function resolveFilePath(rootDirectory: string, path: string): string | null {
  if (!path) return null;
  if (isAbsolute(path)) return path;
  return resolve(rootDirectory, path);
}

export async function findAgentsMdUp(input: {
  startDir: string;
  rootDir: string;
}): Promise<string[]> {
  const found: string[] = [];
  let current = input.startDir;

  while (true) {
    // Skip root AGENTS.md - OpenCode's system.ts already loads it via custom()
    // See: https://github.com/code-yeongyu/oh-my-openagent/issues/379
    const isRootDir = current === input.rootDir;
    if (!isRootDir) {
      const agentsPath = join(current, AGENTS_FILENAME);
      const exists = await fsPromises
        .access(agentsPath, constants.F_OK)
        .then(() => true)
        .catch(() => false);
      if (exists) {
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
