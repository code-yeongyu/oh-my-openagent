import { existsSync, readdirSync } from "node:fs"
import { isAbsolute, join, relative, resolve } from "node:path"

const DEFAULT_CODEX_MARKETPLACE_NAME = "sisyphuslabs"
const DEFAULT_CODEX_PLUGIN_NAME = "omo"

type CodexCacheIdentity = {
  readonly marketplaceName?: string
  readonly pluginName?: string
}

export function resolveDefaultCodexHome(homeDir: string): string {
  return join(homeDir, ".codex")
}

export function resolveCodexPluginCacheRoot(codexHome: string, input: CodexCacheIdentity = {}): string {
  return join(codexHome, "plugins", "cache", input.marketplaceName ?? DEFAULT_CODEX_MARKETPLACE_NAME, input.pluginName ?? DEFAULT_CODEX_PLUGIN_NAME)
}

export function resolveCachedCodexComponentCliPath(pluginRoot: string, componentName: string): string {
  return join(pluginRoot, "components", componentName, "dist", "cli.js")
}

export function resolveCodexComponentBinCandidates(input: {
  readonly executableName: string
  readonly env: { readonly [key: string]: string | undefined }
  readonly homeDir: string
}): readonly string[] {
  return [
    input.env.CODEX_LOCAL_BIN_DIR ? join(input.env.CODEX_LOCAL_BIN_DIR, input.executableName) : undefined,
    join(input.homeDir, ".local", "bin", input.executableName),
    join(resolveDefaultCodexHome(input.homeDir), "bin", input.executableName),
  ].filter((value): value is string => typeof value === "string")
}

export function findNewestCachedCodexComponentCli(input: {
  readonly codexHome: string
  readonly componentName: string
  readonly marketplaceName?: string
  readonly pluginName?: string
}): string | null {
  const versionsRoot = resolveCodexPluginCacheRoot(input.codexHome, input)
  if (!existsSync(versionsRoot)) return null

  const versions = readdirSync(versionsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareVersionNames)
    .reverse()

  for (const version of versions) {
    const candidate = resolveCachedCodexComponentCliPath(join(versionsRoot, version), input.componentName)
    if (existsSync(candidate)) return candidate
  }
  return null
}

export function resolveCachedRuntimePath(pluginRoot: string, sourceRoot: string, runtimePath: string): string {
  const targetPath = resolve(pluginRoot, runtimePath)
  if (isPathInside(targetPath, pluginRoot)) return targetPath
  return resolve(sourceRoot, runtimePath)
}

export function isPathInside(candidatePath: string, rootPath: string): boolean {
  const pathFromRoot = relative(rootPath, candidatePath)
  return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot))
}

function compareVersionNames(left: string, right: string): number {
  const leftParts = left.split(".").map((part) => Number.parseInt(part, 10))
  const rightParts = right.split(".").map((part) => Number.parseInt(part, 10))
  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    const leftValue = Number.isFinite(leftParts[index] ?? Number.NaN) ? leftParts[index] ?? 0 : 0
    const rightValue = Number.isFinite(rightParts[index] ?? Number.NaN) ? rightParts[index] ?? 0 : 0
    if (leftValue !== rightValue) return leftValue - rightValue
  }
  return left.localeCompare(right)
}
