import { delimiter, dirname } from "node:path"
import { createRequire } from "node:module"
import { existsSync } from "node:fs"

type EnvLike = Record<string, string | undefined>

const resolveFromCurrentModule = createRequire(import.meta.url).resolve

export function prependResolvedOpencodeBinToPath(
  env: EnvLike = process.env,
  resolve: (id: string) => string = resolveFromCurrentModule,
  pathExists: (path: string) => boolean = existsSync,
): void {
  let resolvedPath: string
  try {
    resolvedPath = resolve("opencode-ai/bin/opencode")
  } catch {
    return
  }

  if (!pathExists(resolvedPath)) {
    return
  }

  const opencodeBinDir = dirname(resolvedPath)
  if (!pathExists(opencodeBinDir)) {
    return
  }

  const currentPath = env.PATH ?? ""
  const pathSegments = currentPath ? currentPath.split(delimiter) : []

  if (pathSegments.includes(opencodeBinDir)) {
    return
  }

  env.PATH = currentPath
    ? `${opencodeBinDir}${delimiter}${currentPath}`
    : opencodeBinDir
}
