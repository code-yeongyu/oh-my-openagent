import { existsSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { EXCLUDED_DIRS, GITHUB_INSTRUCTIONS_PATTERN, RULE_EXTENSIONS } from "./constants";
import type { DirectoryScanEntry } from "./types";

function isGitHubInstructionsDir(dir: string): boolean {
  return dir.includes(".github/instructions") || dir.endsWith(".github/instructions");
}

function isRuleFile(fileName: string, dir: string): boolean {
  if (isGitHubInstructionsDir(dir)) return GITHUB_INSTRUCTIONS_PATTERN.test(fileName);
  return RULE_EXTENSIONS.some((extension) => fileName.endsWith(extension));
}

export function safeRealpathSync(filePath: string): string {
  try {
    return realpathSync.native(filePath);
  } catch {
    return filePath;
  }
}

export function findRuleFilesRecursive(dir: string, results: DirectoryScanEntry[], visited = new Set<string>()): void {
  if (!existsSync(dir)) return;
  const realDir = safeRealpathSync(dir);
  if (visited.has(realDir)) return;
  visited.add(realDir);
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true, encoding: "utf8" }).sort((left, right) => left.name.localeCompare(right.name));
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) findRuleFilesRecursive(fullPath, results, visited);
      continue;
    }
    if (entry.isFile() && isRuleFile(entry.name, dir)) {
      results.push({ path: fullPath, realPath: safeRealpathSync(fullPath), relativePath: entry.name });
    }
  }
}
