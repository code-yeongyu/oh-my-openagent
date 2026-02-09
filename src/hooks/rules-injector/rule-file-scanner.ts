import { existsSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { GITHUB_INSTRUCTIONS_PATTERN, RULE_EXTENSIONS } from "./constants";

function isGitHubInstructionsDir(dir: string): boolean {
  return dir.includes(".github/instructions") || dir.endsWith(".github/instructions");
}

function isValidRuleFile(fileName: string, dir: string): boolean {
  if (isGitHubInstructionsDir(dir)) {
    return GITHUB_INSTRUCTIONS_PATTERN.test(fileName);
  }
  return RULE_EXTENSIONS.some((ext) => fileName.endsWith(ext));
}

/**
 * Recursively find all rule files (*.md, *.mdc) in a directory
 *
 * @param dir - Directory to search
 * @param results - Array to accumulate results
 */
export function findRuleFilesRecursive(dir: string, results: string[]): void {
  if (!existsSync(dir)) return;

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        findRuleFilesRecursive(fullPath, results);
      } else if (entry.isFile()) {
        if (isValidRuleFile(entry.name, dir)) {
          results.push(fullPath);
        }
      }
    }
  } catch {
    // Permission denied or other errors - silently skip
  }
}

/**
 * Resolve symlinks safely with fallback to original path
 *
 * @param filePath - Path to resolve
 * @returns Real path or original path if resolution fails
 */
export function safeRealpathSync(filePath: string): string {
  try {
    return realpathSync(filePath);
  } catch {
    return filePath;
  }
}
