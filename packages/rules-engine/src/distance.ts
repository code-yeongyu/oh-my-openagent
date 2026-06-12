import { dirname, isAbsolute, relative, win32 } from "node:path";
import { GLOBAL_DISTANCE } from "./constants";

export function calculateDistance(rulePath: string, currentFile: string, projectRoot: string | null): number {
  if (!projectRoot) return GLOBAL_DISTANCE;
  const pathApi = usesWindowsPaths(projectRoot, rulePath, currentFile) ? win32 : { dirname, isAbsolute, relative };
  const ruleRelative = pathApi.relative(projectRoot, pathApi.dirname(rulePath));
  const currentRelative = pathApi.relative(projectRoot, pathApi.dirname(currentFile));
  if (isOutsideProject(ruleRelative, pathApi) || isOutsideProject(currentRelative, pathApi)) return GLOBAL_DISTANCE;
  const ruleParts = toParts(ruleRelative);
  const currentParts = toParts(currentRelative);
  let shared = 0;
  for (let index = 0; index < Math.min(ruleParts.length, currentParts.length); index += 1) {
    if (ruleParts[index] !== currentParts[index]) break;
    shared += 1;
  }
  return currentParts.length - shared;
}

function usesWindowsPaths(...paths: readonly string[]): boolean {
  return paths.every((path) => /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\"));
}

function isOutsideProject(relativePath: string, pathApi: Pick<typeof win32, "isAbsolute">): boolean {
  return relativePath.startsWith("..") || pathApi.isAbsolute(relativePath);
}

function toParts(path: string): string[] {
  return path.split(/[/\\]/).filter(Boolean);
}
