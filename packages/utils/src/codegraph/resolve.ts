import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { spawnSync } from "node:child_process"
import { basename, dirname, join } from "node:path"
import { createRequire } from "node:module"

import { bunWhich } from "../runtime/which"
import { CODEGRAPH_NODE_BIN_ENV, evaluateCodegraphNodeSupport, type CodegraphNodeSupport } from "./node-support"

export type CodegraphCommandSource = "bundled" | "env" | "path" | "provisioned"

export interface CodegraphCommandResolution {
  readonly argsPrefix: readonly string[]
  readonly command: string
  readonly exists: boolean
  readonly source: CodegraphCommandSource
}

export function codegraphCommandRequiresSupportedLocalNode(
  resolution: CodegraphCommandResolution,
): boolean {
  return resolution.source !== "bundled" && resolution.source !== "env" && resolution.source !== "provisioned"
}

export interface ResolveCodegraphCommandOptions {
  readonly env?: Record<string, string | undefined>
  readonly fileExists?: (filePath: string) => boolean
  readonly homeDir?: string
  readonly nodeRuntime?: () => string | null
  readonly nodeVersion?: (nodePath: string) => string | null
  readonly provisioned?: () => string | null
  readonly requireResolve?: (specifier: string) => string
  readonly which?: (commandName: string) => string | null
}

export interface ResolveCodegraphNodeSupportOptions {
  readonly env?: Record<string, string | undefined>
  readonly fileExists?: (filePath: string) => boolean
  readonly nodeVersion?: (nodePath: string) => string | null
  readonly which?: (commandName: string) => string | null
}

const CODEGRAPH_PACKAGE = "@colbymchenry/codegraph"
const CODEGRAPH_ENV_BIN = "OMO_CODEGRAPH_BIN"
const CODEGRAPH_LEGACY_ENV_BIN = "CODEGRAPH_BIN"
const CODEGRAPH_NODE_CANDIDATES = ["node24", "node22", "node20", "node"] as const
const CODEGRAPH_NODE_PATH_CANDIDATES = [
  "/opt/homebrew/opt/node@24/bin/node",
  "/opt/homebrew/opt/node@22/bin/node",
  "/opt/homebrew/opt/node@20/bin/node",
  "/usr/local/opt/node@24/bin/node",
  "/usr/local/opt/node@22/bin/node",
  "/usr/local/opt/node@20/bin/node",
] as const
const requireFromHere = createRequire(import.meta.url)

function defaultRequireResolve(specifier: string): string {
  return requireFromHere.resolve(specifier)
}

function defaultNodeVersion(nodePath: string): string | null {
  if (nodePath === process.execPath && isNodeExecutableName(nodePath)) return process.versions.node

  try {
    const result = spawnSync(nodePath, ["--version"], {
      encoding: "utf8",
      timeout: 2_000,
      windowsHide: true,
    })
    if (result.error !== undefined || result.status !== 0) return null
    const version = `${result.stdout}\n${result.stderr}`.trim().split(/\s+/)[0]
    return version === undefined || version.length === 0 ? null : version
  } catch (error) {
    if (error instanceof Error) return null
    throw error
  }
}

function isNodeExecutableName(filePath: string): boolean {
  const executable = basename(filePath).toLowerCase()
  return executable === "node" || executable === "node.exe" || /^node\d+(\.exe)?$/.test(executable)
}

function looksLikePath(command: string): boolean {
  return command.includes("/") || command.includes("\\") || /^[a-zA-Z]:/.test(command)
}

function resolveConfiguredNodeRuntime(
  configured: string,
  fileExists: (filePath: string) => boolean,
  which: (commandName: string) => string | null,
): string | null {
  if (looksLikePath(configured)) return fileExists(configured) ? configured : null
  return which(configured)
}

function supportsCodegraphNodeRuntime(
  nodePath: string,
  env: Record<string, string | undefined>,
  nodeVersion: (nodePath: string) => string | null,
): boolean {
  const version = nodeVersion(nodePath)
  if (version === null) return false
  return evaluateCodegraphNodeSupport({ env, nodeVersion: version }).supported
}

function defaultNodeRuntime(
  env: Record<string, string | undefined>,
  fileExists: (filePath: string) => boolean,
  which: (commandName: string) => string | null,
  nodeVersion: (nodePath: string) => string | null,
): string | null {
  const configured = env[CODEGRAPH_NODE_BIN_ENV]?.trim()
  if (configured !== undefined && configured.length > 0) {
    const resolved = resolveConfiguredNodeRuntime(configured, fileExists, which)
    return resolved !== null && supportsCodegraphNodeRuntime(resolved, env, nodeVersion) ? resolved : null
  }

  const candidates = [
    ...(isNodeExecutableName(process.execPath) ? [process.execPath] : []),
    ...CODEGRAPH_NODE_CANDIDATES.map((commandName) => which(commandName)).filter((candidate) => candidate !== null),
    ...CODEGRAPH_NODE_PATH_CANDIDATES.filter((candidate) => fileExists(candidate)),
  ]
  const seen = new Set<string>()
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue
    seen.add(candidate)
    if (supportsCodegraphNodeRuntime(candidate, env, nodeVersion)) return candidate
  }
  return null
}

export function resolveCodegraphNodeRuntime(
  options: ResolveCodegraphNodeSupportOptions = {},
): string | null {
  const env = options.env ?? process.env
  return defaultNodeRuntime(
    env,
    options.fileExists ?? existsSync,
    options.which ?? bunWhich,
    options.nodeVersion ?? defaultNodeVersion,
  )
}

export function resolveCodegraphNodeSupport(
  options: ResolveCodegraphNodeSupportOptions = {},
): CodegraphNodeSupport {
  const env = options.env ?? process.env
  const nodeVersion = options.nodeVersion ?? defaultNodeVersion
  const runtime = resolveCodegraphNodeRuntime({ ...options, env, nodeVersion })
  if (runtime === null) {
    return evaluateCodegraphNodeSupport({ env, nodeVersion: "0.0.0" })
  }

  return evaluateCodegraphNodeSupport({ env, nodeVersion: nodeVersion(runtime) ?? "0.0.0" })
}

function defaultProvisionedBin(homeDir: string, fileExists: (filePath: string) => boolean): string | null {
  const binaryName = process.platform === "win32" ? "codegraph.cmd" : "codegraph"
  const candidates = [
    join(homeDir, ".omo", "codegraph", "bin", binaryName),
    join(homeDir, ".omo", "codegraph", "node-servers", "node_modules", ".bin", binaryName),
  ]
  return candidates.find((candidate) => fileExists(candidate)) ?? null
}

function resolveBundledShim(
  requireResolve: (specifier: string) => string,
  fileExists: (filePath: string) => boolean,
): string | null {
  try {
    const packageJson = requireResolve(`${CODEGRAPH_PACKAGE}/package.json`)
    const packageRoot = dirname(packageJson)
    const candidates = [join(packageRoot, "bin", "codegraph.js"), join(packageRoot, "npm-shim.js")]
    return candidates.find((candidate) => fileExists(candidate)) ?? null
  } catch (error) {
    if (error instanceof Error) return null
    if (error === null || error === undefined) return null
    if (typeof error === "object" || typeof error === "string" || typeof error === "number") return null
    if (typeof error === "boolean" || typeof error === "bigint" || typeof error === "symbol") return null
    return null
  }
}

export function resolveCodegraphCommand(
  options: ResolveCodegraphCommandOptions = {},
): CodegraphCommandResolution {
  const env = options.env ?? process.env
  const fileExists = options.fileExists ?? existsSync
  const configuredBin = env[CODEGRAPH_ENV_BIN]?.trim() || env[CODEGRAPH_LEGACY_ENV_BIN]?.trim()
  if (configuredBin !== undefined && configuredBin.length > 0) {
    return { argsPrefix: [], command: configuredBin, exists: fileExists(configuredBin), source: "env" }
  }

  const which = options.which ?? bunWhich
  const nodeRuntime =
    options.nodeRuntime ?? (() => defaultNodeRuntime(env, fileExists, which, options.nodeVersion ?? defaultNodeVersion))
  const bundled = resolveBundledShim(options.requireResolve ?? defaultRequireResolve, fileExists)
  const runtime = nodeRuntime()
  if (bundled !== null && runtime !== null) {
    return { argsPrefix: [bundled], command: runtime, exists: true, source: "bundled" }
  }

  const provisioned =
    options.provisioned?.() ?? defaultProvisionedBin(options.homeDir ?? homedir(), fileExists)
  if (provisioned !== null && fileExists(provisioned)) {
    return { argsPrefix: [], command: provisioned, exists: true, source: "provisioned" }
  }

  const pathCommand = which("codegraph")
  return {
    argsPrefix: [],
    command: pathCommand ?? "codegraph",
    exists: pathCommand !== null,
    source: "path",
  }
}
