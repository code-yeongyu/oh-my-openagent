import { findRuleFilesRecursive as findRuleFileEntriesRecursive, safeRealpathSync } from "@oh-my-opencode/rules-engine";
import type { DirectoryScanEntry } from "@oh-my-opencode/rules-engine";

export { safeRealpathSync };

export function findRuleFilesRecursive(dir: string, results: string[]): void {
  const entries: DirectoryScanEntry[] = [];
  findRuleFileEntriesRecursive(dir, entries);
  results.push(...entries.map((entry) => entry.path));
}
