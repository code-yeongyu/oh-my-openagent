import { findAgentsMdUp as findAgentsMdUpCore } from "@oh-my-opencode/rules-core";
import type { AgentsMdCache } from "@oh-my-opencode/rules-core";
import { isAbsolute, resolve } from "node:path";

export function resolveFilePath(rootDirectory: string, path: string): string | null {
  if (!path) return null;
  if (isAbsolute(path)) return path;
  return resolve(rootDirectory, path);
}

export async function findAgentsMdUp(input: {
  readonly startDir: string;
  readonly rootDir: string;
  readonly cache?: AgentsMdCache;
}): Promise<string[]> {
  return findAgentsMdUpCore({ startDir: input.startDir, rootDir: input.rootDir, cache: input.cache });
}
