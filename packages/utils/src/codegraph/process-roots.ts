import { existsSync, readdirSync, realpathSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

import { CODEGRAPH_INSTALL_DIR_ENV, buildCodegraphEnv } from "./env"

export interface CodegraphOwnedRootsOptions {
  readonly codexHome?: string
  readonly env?: Record<string, string | undefined>
  readonly extraRoots?: readonly string[]
  readonly homeDir?: string
  readonly pluginRoot?: string
  readonly trustedCodegraphInstallDir?: string
}

export function discoverCodegraphOwnedRoots(options: CodegraphOwnedRootsOptions = {}): string[] {
  const env = options.env ?? process.env
  const homeDir = options.homeDir ?? env["HOME"] ?? env["USERPROFILE"] ?? homedir()
  const roots = new Set<string>()
  addRoot(roots, options.trustedCodegraphInstallDir)
  addRoot(roots, buildCodegraphEnv({ homeDir })[CODEGRAPH_INSTALL_DIR_ENV])
  addRoot(roots, options.pluginRoot)
  for (const root of options.extraRoots ?? []) addRoot(roots, root)
  for (const root of readCodexPluginCacheRoots(options.codexHome ?? env["CODEX_HOME"] ?? join(homeDir, ".codex"))) {
    addRoot(roots, root)
  }
  return [...roots]
}

function readCodexPluginCacheRoots(codexHome: string): string[] {
  const cacheRoot = join(codexHome, "plugins", "cache")
  if (!existsSync(cacheRoot)) return []
  const roots: string[] = []
  for (const publisher of safeReadDir(cacheRoot)) {
    if (!OMO_CODEX_PLUGIN_CACHE_PUBLISHERS.has(publisher)) continue
    const omoRoot = join(cacheRoot, publisher, "omo")
    if (!existsSync(omoRoot)) continue
    for (const version of safeReadDir(omoRoot)) roots.push(join(omoRoot, version))
  }
  return roots
}

function addRoot(roots: Set<string>, root: string | undefined): void {
  if (root === undefined || root.trim().length === 0) return
  const resolved = resolve(root)
  roots.add(resolved)
  roots.add(realpathIfPossible(resolved))
}

function safeReadDir(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch (error) {
    if (isNonFatalFsError(error)) return []
    throw error
  }
}

function realpathIfPossible(path: string): string {
  try {
    return realpathSync(path)
  } catch (error) {
    if (error instanceof Error) return resolve(path)
    throw error
  }
}

function isNonFatalFsError(error: unknown): error is Error {
  if (!(error instanceof Error)) return false
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined
  return typeof code === "string" && ["EACCES", "ENOENT", "ENOTDIR", "EPERM"].includes(code)
}
const OMO_CODEX_PLUGIN_CACHE_PUBLISHERS = new Set(["sisyphuslabs"])
