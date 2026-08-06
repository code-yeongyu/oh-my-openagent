import { existsSync, readFileSync } from "node:fs"
import { delimiter, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import { getOpenCodeConfigDir } from "../shared/opencode-config-dir"
import { hasCliSuffix } from "./cli-suffix"
import { resolveRuntimeExecutable, type RuntimeExecutableResolver } from "./runtime-executable"
import { createAncestorCliCandidates, resolveJavaScriptRuntime, type AncestorCliCandidate } from "./shared/ancestor-cli-resolver"

const PACKAGE_REL = "packages/lsp-daemon"
const LSP_TOOLS_PACKAGE_REL = "packages/lsp-tools-mcp"
const DIST_CLI_REL = "dist/cli.js"
const SOURCE_CLI_REL = "src/cli.ts"
const PROJECT_LSP_CONFIGS = [".opencode/lsp.json", ".omo/lsp.json", ".omo/lsp-client.json"] as const
const DAEMON_PACKAGE_NAME = "@code-yeongyu/lsp-daemon"
const OMO_LSP_DAEMON_CLI = "OMO_LSP_DAEMON_CLI"
const OMO_LSP_DAEMON_VERSION = "OMO_LSP_DAEMON_VERSION"
const DaemonPackageSchema = z.object({
  version: z.string().min(1),
})
const LSP_BOOTSTRAP_SCRIPT = [
  "const { existsSync } = require('node:fs')",
  "const { createRequire } = require('node:module')",
  "const { join } = require('node:path')",
  "const { spawnSync } = require('node:child_process')",
  "const root = process.argv[1]",
  "const npm = process.argv[2] || 'npm'",
  "const bun = process.argv[3] || 'bun'",
  `const toolsPackage = join(root, '${LSP_TOOLS_PACKAGE_REL}')`,
  `const daemonPackage = join(root, '${PACKAGE_REL}')`,
  "const toolsDist = join(toolsPackage, 'dist/cli.js')",
  "const daemonPackageJson = join(daemonPackage, 'package.json')",
  "const daemonSource = join(daemonPackage, 'src/cli.ts')",
  "const run = (command, args, stdio) => spawnSync(command, args, { cwd: root, env: process.env, stdio })",
  "const finish = (result) => { if (result.error) { console.error(result.error.message); process.exit(1) } process.exit(result.status ?? 1) }",
  "const runIfAvailable = (command, args) => { const result = run(command, args, 'inherit'); if (result.error) return false; finish(result); return true }",
  `const resolveDaemonCli = () => { try { return createRequire(daemonPackageJson).resolve('${DAEMON_PACKAGE_NAME}/cli') } catch (error) { if (error instanceof Error) return null; throw error } }`,
  "const daemonCli = existsSync(daemonPackageJson) ? resolveDaemonCli() : null",
  "if (daemonCli) finish(run(process.execPath, [daemonCli, 'mcp'], 'inherit'))",
  `if (existsSync(daemonSource) && existsSync(toolsDist)) { const pkg = require(daemonPackageJson); process.env.${OMO_LSP_DAEMON_CLI} = daemonSource; process.env.${OMO_LSP_DAEMON_VERSION} = pkg.version; runIfAvailable(bun, [daemonSource, 'mcp']) }`,
  "const steps = [[npm, ['--prefix', toolsPackage, 'install', '--no-package-lock', '--no-audit', '--no-fund']], [npm, ['--prefix', toolsPackage, 'run', 'build']], [npm, ['--prefix', daemonPackage, 'install', '--no-package-lock', '--no-audit', '--no-fund']], [npm, ['--prefix', daemonPackage, 'run', 'build']]]",
  "for (const [command, args] of steps) { const result = run(command, args, ['ignore', 'ignore', 'inherit']); if (result.error || result.status !== 0) finish(result) }",
  "finish(run(process.execPath, [resolveDaemonCli(), 'mcp'], 'inherit'))",
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
  cwd?: string
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

function readDaemonPackageVersion(root: string): string | null {
  try {
    const packageJson = JSON.parse(readFileSync(resolve(root, PACKAGE_REL, "package.json"), "utf-8"))
    return DaemonPackageSchema.parse(packageJson).version
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return null
  }
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
        isSourceCandidateAvailable: ({ root }) =>
          pathExists(resolve(root, LSP_TOOLS_PACKAGE_REL, DIST_CLI_REL)) && readDaemonPackageVersion(root) !== null,
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
  const cwd = resolve(options.cwd ?? process.cwd())
  const configDir = getOpenCodeConfigDir({ binary: "opencode" })
  const sourceVersion = hasCliSuffix(resolvedCommand.path, SOURCE_CLI_REL) ? readDaemonPackageVersion(resolvedCommand.root) : null

  return {
    type: "local",
    command: resolvedCommand.command,
    enabled: resolvedCommand.exists,
    cwd,
    environment: {
      LSP_TOOLS_MCP_PROJECT_CONFIG: PROJECT_LSP_CONFIGS.map((configPath) => resolve(cwd, configPath)).join(delimiter),
      LSP_TOOLS_MCP_USER_CONFIG: resolve(configDir, "lsp.json"),
      LSP_TOOLS_MCP_INSTALL_DECISIONS: resolve(configDir, "lsp-install-decisions.json"),
      ...(sourceVersion
        ? {
            [OMO_LSP_DAEMON_CLI]: resolvedCommand.path,
            [OMO_LSP_DAEMON_VERSION]: sourceVersion,
          }
        : {}),
    },
  }
}
