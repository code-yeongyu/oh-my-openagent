import {
  existsSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import {
  GITHUB_INSTRUCTIONS_PATTERN,
  PROJECT_MARKERS,
  PROJECT_RULE_FILES,
  PROJECT_RULE_SUBDIRS,
  RULE_EXTENSIONS,
  USER_RULE_DIR,
} from "./constants";
import type { RuleFileCandidate } from "./types";

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
 * Find project root by walking up from startPath.
 * Checks for PROJECT_MARKERS (.git, pyproject.toml, package.json, etc.)
 *
 * @param startPath - Starting path to search from (file or directory)
 * @returns Project root path or null if not found
 */
export function findProjectRoot(startPath: string): string | null {
  let current: string;

  try {
    const stat = statSync(startPath);
    current = stat.isDirectory() ? startPath : dirname(startPath);
  } catch {
    current = dirname(startPath);
  }

  while (true) {
    for (const marker of PROJECT_MARKERS) {
      const markerPath = join(current, marker);
      if (existsSync(markerPath)) {
        return current;
      }
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

/**
 * Recursively find all rule files (*.md, *.mdc) in a directory
 *
 * @param dir - Directory to search
 * @param results - Array to accumulate results
 */
function findRuleFilesRecursive(dir: string, results: string[]): void {
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
function safeRealpathSync(filePath: string): string {
  try {
    return realpathSync(filePath);
  } catch {
    return filePath;
  }
}

/**
 * Calculate directory distance between a rule file and current file.
 * Distance is based on common ancestor within project root.
 *
 * @param rulePath - Path to the rule file
 * @param currentFile - Path to the current file being edited
 * @param projectRoot - Project root for relative path calculation
 * @returns Distance (0 = same directory, higher = further)
 */
export function calculateDistance(
  rulePath: string,
  currentFile: string,
  projectRoot: string | null,
): number {
  if (!projectRoot) {
    return 9999;
  }

  try {
    const ruleDir = dirname(rulePath);
    const currentDir = dirname(currentFile);

    const ruleRel = relative(projectRoot, ruleDir);
    const currentRel = relative(projectRoot, currentDir);

    // Handle paths outside project root
    if (ruleRel.startsWith("..") || currentRel.startsWith("..")) {
      return 9999;
    }

    // Split by both forward and back slashes for cross-platform compatibility
    // path.relative() returns OS-native separators (backslashes on Windows)
    const ruleParts = ruleRel ? ruleRel.split(/[/\\]/) : [];
    const currentParts = currentRel ? currentRel.split(/[/\\]/) : [];

    // Find common prefix length
    let common = 0;
    for (let i = 0; i < Math.min(ruleParts.length, currentParts.length); i++) {
      if (ruleParts[i] === currentParts[i]) {
        common++;
      } else {
        break;
      }
    }

    // Distance is how many directories up from current file to common ancestor
    return currentParts.length - common;
  } catch {
    return 9999;
  }
}

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
