import { dirname, relative } from "node:path";

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
