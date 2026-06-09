import { isAbsolute, relative, resolve } from "node:path"

export function resolveCachedRuntimePath(pluginRoot: string, sourceRoot: string, runtimePath: string): string {
  const targetPath = resolve(pluginRoot, runtimePath)
  if (isPathInside(targetPath, pluginRoot)) return targetPath
  return resolve(sourceRoot, runtimePath)
}

export function isPathInside(candidatePath: string, rootPath: string): boolean {
  const pathFromRoot = relative(rootPath, candidatePath)
  return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot))
}
