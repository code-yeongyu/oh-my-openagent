import { dirname, relative } from "node:path";
import { GLOBAL_DISTANCE } from "./constants";

export function calculateDistance(rulePath: string, currentFile: string, projectRoot: string | null): number {
  if (!projectRoot) return GLOBAL_DISTANCE;
  try {
    const ruleRelative = relative(projectRoot, dirname(rulePath));
    const currentRelative = relative(projectRoot, dirname(currentFile));
    if (ruleRelative.startsWith("..") || currentRelative.startsWith("..")) return GLOBAL_DISTANCE;
    const ruleParts = toParts(ruleRelative);
    const currentParts = toParts(currentRelative);
    let shared = 0;
    for (let index = 0; index < Math.min(ruleParts.length, currentParts.length); index += 1) {
      if (ruleParts[index] !== currentParts[index]) break;
      shared += 1;
    }
    return currentParts.length - shared;
  } catch {
    return GLOBAL_DISTANCE;
  }
}

function toParts(path: string): string[] {
  return path.split(/[/\\]/).filter(Boolean);
}
