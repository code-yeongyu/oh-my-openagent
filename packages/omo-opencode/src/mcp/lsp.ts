import { existsSync } from "node:fs"
import { delimiter, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { hasCliSuffix } from "./cli-suffix"
import { resolveRuntimeExecutable, type RuntimeExecutableResolver } from "./runtime-executable"
import { createAncestorCliCandidates, resolveJavaScriptRuntime, type AncestorCliCandidate } from "./shared/ancestor-cli-resolver"

const PACKAGE_REL = "packages/lsp-daemon"
const LSP_TOOLS_PACKAGE_REL = "packages/lsp-tools-mcp"
const DIST_CLI_REL = "dist/cli.js"
const SOURCE_CLI_REL = "src/cli.ts"
const PROJECT_LSP_CONFIGS = [".opencode/lsp.json", ".omo/lsp.json", ".omo/lsp-client.json"] as const
const LSP_BOOTSTRAP_SCRIPT = [
  "const { existsSync } = require('node:fs')",
  "const { join } = require('node:path')",
  "const { spawnSync } = require('node:child_process')",
  "const root = process.argv[1]",
  "const npm = process.argv[2] || 'npm'",
  "const bun = process.argv[3] || 'bun'",
  `const toolsPackage = join(root, '${LSP_TOOLS_PACKAGE_REL}')`,
  `const daemonPackage = join(root, '${PACKAGE_REL}')`,
  "const toolsDist = join(toolsPackage, 'dist/cli.js')",
  "const daemonDist = join(daemonPackage, 'dist/cli.js')",
  "const daemonSource = join(daemonPackage, 'src/cli.ts')",
  "const run = (command, args, stdio) => spawnSync(command, args, { cwd: root, env: process.env, stdio })",
  "const finish = (result) => { if (result.error) { console.error(result.error.message); process.exit(1) } process.exit(result.status ?? 1) }",
  "const runIfAvailable = (command, args) => { const result = run(command, args, 'inherit'); if (result.error) return false; finish(result); return true }",
  "if (existsSync(daemonDist)) finish(run(process.execPath, [daemonDist, 'mcp'], 'inherit'))",
  "if (existsSync(daemonSource) && existsSync(toolsDist)) runIfAvailable(bun, [daemonSource, 'mcp'])",
  "const steps = [[npm, ['--prefix', toolsPackage, 'install', '--no-package-lock', '--no-audit', '--no-fund']], [npm, ['--prefix', toolsPackage, 'run', 'build']], [npm, ['--prefix', daemonPackage, 'install', '--no-package-lock', '--no-audit', '--no-fund']], [npm, ['--prefix', daemonPackage, 'run', 'build']]]",
  "for (const [command, args] of steps) { const result = run(command, args, ['ignore', 'ignore', 'inherit']); if (result.error || result.status !== 0) finish(result) }",
  "finish(run(process.execPath, [daemonDist, 'mcp'], 'inherit'))",
].join(";")

type LspMcpConfigOptions = {
  readonly cwd?: string
  readonly moduleUrl?: string
  readonly exists?: (path: string) => boolean
  readonly resolveExecutable?: RuntimeExecutableResolver
}

export type LocalMcpConfig = {
  type: "local"
  command: string[]
  enabled: boolean
  environment?: Record<string, string>
}

function getModuleDirectory(moduleUrl: string): string | null {
  try {
    return dirname(fileURLToPath(moduleUrl))
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return null
  }
}

function findBootstrapRoot(candidates: readonly AncestorCliCandidate[], pathExists: (path: string) => boolean): string {
  return candidates.find((candidate) => pathExists(resolve(candidate.root, "package.json")))?.root ?? process.cwd()
}

function createBootstrapCandidate(
  root: string,
  pathExists: (path: string) => boolean,
  resolveExecutable: RuntimeExecutableResolver,
): AncestorCliCandidate {
  const runtime = resolveJavaScriptRuntime(resolveExecutable)
  const bun = resolveExecutable("bun")
  const npm = resolveExecutable("npm")
  const packageManifestPath = resolve(root, PACKAGE_REL, "package.json")

  return {
    command: [runtime.command, "-e", LSP_BOOTSTRAP_SCRIPT, root, npm.command, bun.command],
    root,
    path: resolve(root, PACKAGE_REL, DIST_CLI_REL),
    exists: runtime.available && npm.available && pathExists(packageManifestPath),
    runtimeAvailable: runtime.available,
  }
}

function resolveLspCommand(options: LspMcpConfigOptions = {}): AncestorCliCandidate {
  const pathExists = options.exists ?? existsSync
  const resolveExecutable = options.resolveExecutable ?? resolveRuntimeExecutable
  const moduleDirectory = getModuleDirectory(options.moduleUrl ?? import.meta.url)

  const candidates = moduleDirectory
    ? createAncestorCliCandidates({
        startDirectory: moduleDirectory,
        packageRel: PACKAGE_REL,
        distCliRel: DIST_CLI_REL,
        sourceCliRel: SOURCE_CLI_REL,
        pathExists,
        resolveExecutable,
        isSourceCandidateAvailable: ({ root }) => pathExists(resolve(root, LSP_TOOLS_PACKAGE_REL, DIST_CLI_REL)),
      })
    : []

  const distCandidate = candidates.find((candidate) => hasCliSuffix(candidate.path, DIST_CLI_REL) && candidate.exists)
  if (distCandidate) {
    return distCandidate
  }

  const sourceCandidate = candidates.find(
    (candidate) => hasCliSuffix(candidate.path, SOURCE_CLI_REL) && candidate.exists,
  )
  if (sourceCandidate) {
    return sourceCandidate
  }

  return createBootstrapCandidate(findBootstrapRoot(candidates, pathExists), pathExists, resolveExecutable)
}

export function createLspMcpConfig(options: LspMcpConfigOptions = {}): LocalMcpConfig {
  const resolvedCommand = resolveLspCommand(options)

  return {
    type: "local",
    command: resolvedCommand.command,
    enabled: resolvedCommand.exists,
    environment: {
      LSP_TOOLS_MCP_PROJECT_CONFIG: PROJECT_LSP_CONFIGS.join(delimiter),
    },
  }
}
