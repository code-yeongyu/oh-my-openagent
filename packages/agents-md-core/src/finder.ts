import { isAbsolute, resolve } from "node:path";

export function resolveFilePath(rootDirectory: string, path: string): string | null {
  if (!path) return null;
  if (isAbsolute(path)) return path;
  return resolve(rootDirectory, path);
}
