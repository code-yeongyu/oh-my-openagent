import { join } from "node:path"

export function isBunGlobalEntrypointPath(invokedPath: string | undefined, env: NodeJS.ProcessEnv): boolean {
  if (typeof invokedPath !== "string" || invokedPath.trim().length === 0) return false
  const normalizedPath = normalizePathForPrefix(invokedPath)
  return resolveBunGlobalRoots(env).some((root) => normalizedPath.startsWith(root))
}

function resolveBunGlobalRoots(env: NodeJS.ProcessEnv): readonly string[] {
  const bunInstallRoot = env.BUN_INSTALL?.trim()
  const homeRoot = env.HOME?.trim()
  return [
    ...(bunInstallRoot ? [join(bunInstallRoot, "bin"), join(bunInstallRoot, "install", "global", "node_modules")] : []),
    ...(homeRoot ? [join(homeRoot, ".bun", "bin"), join(homeRoot, ".bun", "install", "global", "node_modules")] : []),
  ].map(normalizePathForPrefix)
}

function normalizePathForPrefix(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/, "")
  return normalized.endsWith("/node_modules") || normalized.endsWith("/bin") ? `${normalized}/` : normalized
}
