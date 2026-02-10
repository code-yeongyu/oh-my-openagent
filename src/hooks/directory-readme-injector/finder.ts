import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { README_FILENAME } from "./constants";

export function resolveFilePath(rootDirectory: string, path: string): string | null {
  if (!path) return null;
  if (path.startsWith("/")) return path;
  return resolve(rootDirectory, path);
}

export function findReadmeMdUp(input: {
  startDir: string;
  rootDir: string;
}): string[] {
  const found: string[] = [];
  let current = input.startDir;

  while (true) {
    const readmePath = join(current, README_FILENAME);
    if (existsSync(readmePath)) {
      found.push(readmePath);
    }

    if (current === input.rootDir) break;
    const parent = dirname(current);
    if (parent === current) break;
    if (!parent.startsWith(input.rootDir)) break;
    current = parent;
  }

  return found.reverse();
}
