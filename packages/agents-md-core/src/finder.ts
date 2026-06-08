import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

export function resolveFilePath(rootDirectory: string, path: string): string | null {
  if (!path) return null;
  const resolved = isAbsolute(path) ? path : resolve(rootDirectory, path);
  const canonicalRoot = canonicalizePath(rootDirectory);
  const canonicalResolved = canonicalizePath(resolved);
  return isSameOrChildPath(canonicalResolved, canonicalRoot) ? canonicalResolved : null;
}

function canonicalizePath(path: string): string {
  try {
    return realpathSync(path);
  } catch (error) {
    if (error instanceof Error) {
      return resolve(path);
    }
    throw error;
  }
}

function isSameOrChildPath(childPath: string, parentPath: string): boolean {
  const relativePath = relative(parentPath, childPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}
