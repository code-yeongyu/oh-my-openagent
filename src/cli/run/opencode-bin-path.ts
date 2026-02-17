import { delimiter, dirname } from "node:path"
import { createRequire } from "node:module"

type EnvLike = Record<string, string | undefined>

const resolveFromCurrentModule = createRequire(import.meta.url).resolve

export function prependResolvedOpencodeBinToPath(
  env: EnvLike = process.env,
  resolve: (id: string) => string = resolveFromCurrentModule,
): void {
  let resolvedPath: string
  try {
    resolvedPath = resolve("opencode-ai/bin/opencode")
  } catch {
    return
  }

  const opencodeBinDir = dirname(resolvedPath)
  const currentPath = env.PATH ?? ""
  const pathSegments = currentPath ? currentPath.split(delimiter) : []

  if (pathSegments.includes(opencodeBinDir)) {
    return
  }

  env.PATH = currentPath
    ? `${opencodeBinDir}${delimiter}${currentPath}`
    : opencodeBinDir
}
