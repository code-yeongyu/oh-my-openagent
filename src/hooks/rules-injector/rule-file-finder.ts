import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  PROJECT_RULE_FILES,
  PROJECT_RULE_SUBDIRS,
  USER_RULE_DIR,
} from "./constants";
import type { RuleFileCandidate } from "./types";
import { findRuleFilesRecursive, safeRealpathSync } from "./rule-file-scanner";

/**
 * Find all rule files for a given context.
 * Searches from currentFile upward to projectRoot for rule directories,
 * then user-level directory (~/.claude/rules).
 *
 * IMPORTANT: This searches EVERY directory from file to project root.
 * Not just the project root itself.
 *
 * @param projectRoot - Project root path (or null if outside any project)
 * @param homeDir - User home directory
 * @param currentFile - Current file being edited (for distance calculation)
 * @returns Array of rule file candidates sorted by distance
 */
export function findRuleFiles(
  projectRoot: string | null,
  homeDir: string,
  currentFile: string,
): RuleFileCandidate[] {
  const candidates: RuleFileCandidate[] = [];
  const seenRealPaths = new Set<string>();

  // Search from current file's directory up to project root
  let currentDir = dirname(currentFile);
  let distance = 0;

  while (true) {
    // Search rule directories in current directory
    for (const [parent, subdir] of PROJECT_RULE_SUBDIRS) {
      const ruleDir = join(currentDir, parent, subdir);
      const files: string[] = [];
      findRuleFilesRecursive(ruleDir, files);

      for (const filePath of files) {
        const realPath = safeRealpathSync(filePath);
        if (seenRealPaths.has(realPath)) continue;
        seenRealPaths.add(realPath);

        candidates.push({
          path: filePath,
          realPath,
          isGlobal: false,
          distance,
        });
      }
    }

    // Stop at project root or filesystem root
    if (projectRoot && currentDir === projectRoot) break;
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
    distance++;
  }

  // Check for single-file rules at project root (e.g., .github/copilot-instructions.md)
  if (projectRoot) {
    for (const ruleFile of PROJECT_RULE_FILES) {
      const filePath = join(projectRoot, ruleFile);
      if (existsSync(filePath)) {
        try {
          const stat = statSync(filePath);
          if (stat.isFile()) {
            const realPath = safeRealpathSync(filePath);
            if (!seenRealPaths.has(realPath)) {
              seenRealPaths.add(realPath);
              candidates.push({
                path: filePath,
                realPath,
                isGlobal: false,
                distance: 0,
                isSingleFile: true,
              });
            }
          }
        } catch {
          // Skip if file can't be read
        }
      }
    }
  }

  // Search user-level rule directory (~/.claude/rules)
  const userRuleDir = join(homeDir, USER_RULE_DIR);
  const userFiles: string[] = [];
  findRuleFilesRecursive(userRuleDir, userFiles);

  for (const filePath of userFiles) {
    const realPath = safeRealpathSync(filePath);
    if (seenRealPaths.has(realPath)) continue;
    seenRealPaths.add(realPath);

    candidates.push({
      path: filePath,
      realPath,
      isGlobal: true,
      distance: 9999, // Global rules always have max distance
    });
  }

  // Sort by distance (closest first, then global rules last)
  candidates.sort((a, b) => {
    if (a.isGlobal !== b.isGlobal) {
      return a.isGlobal ? 1 : -1;
    }
    return a.distance - b.distance;
  });

  return candidates;
}
