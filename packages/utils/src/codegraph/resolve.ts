import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { createRequire } from "node:module"

import { bunWhich } from "../runtime/which"

export type CodegraphCommandSource = "bundled" | "env" | "path" | "provisioned"

export interface CodegraphCommandResolution {
  readonly argsPrefix: readonly string[]
  readonly command: string
  readonly exists: boolean
  readonly source: CodegraphCommandSource
}

export interface ResolveCodegraphCommandOptions {
  readonly env?: Record<string, string | undefined>
  readonly fileExists?: (filePath: string) => boolean
  readonly homeDir?: string
  readonly nodeRuntime?: () => string | null
  readonly provisioned?: () => string | null
  readonly requireResolve?: (specifier: string) => string
  readonly which?: (commandName: string) => string | null
}

const CODEGRAPH_PACKAGE = "@colbymchenry/codegraph"
const CODEGRAPH_ENV_BIN = "OMO_CODEGRAPH_BIN"
const CODEGRAPH_LEGACY_ENV_BIN = "CODEGRAPH_BIN"
const requireFromHere = createRequire(import.meta.url)

function defaultRequireResolve(specifier: string): string {
  return requireFromHere.resolve(specifier)
}

function defaultNodeRuntime(): string | null {
  return process.execPath || null
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

  const nodeRuntime = options.nodeRuntime ?? defaultNodeRuntime
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

  const pathCommand = (options.which ?? bunWhich)("codegraph")
  return {
    argsPrefix: [],
    command: pathCommand ?? "codegraph",
    exists: pathCommand !== null,
    source: "path",
  }
}
