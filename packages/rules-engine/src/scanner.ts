import { existsSync, readdirSync, realpathSync, type Dirent } from "node:fs";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { EXCLUDED_DIRS, GITHUB_INSTRUCTIONS_PATTERN, RULE_EXTENSIONS } from "./constants";
import type { DirectoryScanEntry } from "./types";

function isGitHubInstructionsDir(dir: string): boolean {
  const normalizedDir = dir.replaceAll("\\", "/");
  return normalizedDir.includes(".github/instructions") || normalizedDir.endsWith(".github/instructions");
}

function isRuleFile(fileName: string, dir: string): boolean {
  if (isGitHubInstructionsDir(dir)) return GITHUB_INSTRUCTIONS_PATTERN.test(fileName);
  return RULE_EXTENSIONS.some((extension) => fileName.endsWith(extension));
}

export function safeRealpathSync(filePath: string): string {
  try {
    return realpathSync.native(filePath);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    const parentPath = dirname(filePath);
    if (parentPath === filePath) return filePath;
    return join(safeRealpathSync(parentPath), basename(filePath));
  }
}

function isPathWithinRoot(candidate: string, root: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function findRuleFilesRecursive(
  dir: string,
  results: DirectoryScanEntry[],
  visited = new Set<string>(),
  boundaryRoot?: string,
): void {
  if (!existsSync(dir)) return;
  const realDir = safeRealpathSync(dir);
  const effectiveBoundary = boundaryRoot === undefined ? realDir : safeRealpathSync(boundaryRoot);
  if (!isPathWithinRoot(realDir, effectiveBoundary)) return;
  if (visited.has(realDir)) return;
  visited.add(realDir);
  let entries: Dirent<string>[] = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true, encoding: "utf8" }).sort((left, right) => left.name.localeCompare(right.name));
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) findRuleFilesRecursive(fullPath, results, visited, effectiveBoundary);
      continue;
    }
    if (entry.isFile() && isRuleFile(entry.name, dir)) {
      const realPath = safeRealpathSync(fullPath);
      if (!isPathWithinRoot(realPath, effectiveBoundary)) continue;
      results.push({ path: fullPath, realPath, relativePath: entry.name });
    }
  }
}
