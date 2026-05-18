import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const SUBMODULE_REL = "packages/lsp-tools-mcp"
const DIST_CLI_REL = "dist/cli.js"
const SOURCE_CLI_REL = "src/cli.ts"
const PROJECT_LSP_CONFIG = ".opencode/lsp.json"
const LSP_BOOTSTRAP_SCRIPT = [
  "const { existsSync } = require('node:fs')",
  "const { join } = require('node:path')",
  "const { spawnSync } = require('node:child_process')",
  "const root = process.argv[1]",
  "const submodule = join(root, 'packages/lsp-tools-mcp')",
  "const dist = join(submodule, 'dist/cli.js')",
  "const source = join(submodule, 'src/cli.ts')",
  "const run = (command, args, stdio) => spawnSync(command, args, { cwd: root, env: process.env, stdio })",
  "const finish = (result) => { if (result.error) { console.error(result.error.message); process.exit(1) } process.exit(result.status ?? 1) }",
  "const runIfAvailable = (command, args) => { const result = run(command, args, 'inherit'); if (result.error) return false; finish(result); return true }",
  "if (existsSync(dist)) finish(run(process.execPath, [dist, 'mcp'], 'inherit'))",
  "if (existsSync(source)) runIfAvailable('bun', [source, 'mcp'])",
  "const submoduleResult = run('git', ['submodule', 'update', '--init', '--recursive', 'packages/lsp-tools-mcp'], ['ignore', 'ignore', 'inherit'])",
  "if (submoduleResult.error || submoduleResult.status !== 0) finish(submoduleResult)",
  "if (existsSync(dist)) finish(run(process.execPath, [dist, 'mcp'], 'inherit'))",
  "if (existsSync(source)) runIfAvailable('bun', [source, 'mcp'])",
  "for (const [command, args] of [['npm', ['--prefix', submodule, 'install', '--no-package-lock', '--no-audit', '--no-fund']], ['npm', ['--prefix', submodule, 'run', 'build']]]) { const result = run(command, args, ['ignore', 'ignore', 'inherit']); if (result.error || result.status !== 0) finish(result) }",
  "finish(run(process.execPath, [dist, 'mcp'], 'inherit'))",
].join(";")

type LspMcpConfigOptions = {
  readonly cwd?: string
  readonly moduleUrl?: string
  readonly exists?: (path: string) => boolean
}

type LspCommandCandidate = {
  readonly command: string[]
  readonly root: string
  readonly path: string
  readonly exists: boolean
}

export type LocalMcpConfig = {
  type: "local"
  command: string[]
  enabled: boolean
  environment?: Record<string, string>
}

function addAncestorCommandCandidates(
  startDirectory: string,
  target: LspCommandCandidate[],
  seenPaths: Set<string>,
  pathExists: (path: string) => boolean,
): void {
  let currentDirectory = resolve(startDirectory)

  while (true) {
    const distCliPath = resolve(currentDirectory, SUBMODULE_REL, DIST_CLI_REL)
    if (!seenPaths.has(distCliPath)) {
      seenPaths.add(distCliPath)
      target.push({
        command: ["node", distCliPath, "mcp"],
        root: currentDirectory,
        path: distCliPath,
        exists: pathExists(distCliPath),
      })
    }

    const sourceCliPath = resolve(currentDirectory, SUBMODULE_REL, SOURCE_CLI_REL)
    if (!seenPaths.has(sourceCliPath)) {
      seenPaths.add(sourceCliPath)
      target.push({
        command: ["bun", sourceCliPath, "mcp"],
        root: currentDirectory,
        path: sourceCliPath,
        exists: pathExists(sourceCliPath),
      })
    }

    const parentDirectory = resolve(currentDirectory, "..")
    if (parentDirectory === currentDirectory) {
      return
    }

    currentDirectory = parentDirectory
  }
}

function getModuleDirectory(moduleUrl: string): string | null {
  try {
    return dirname(fileURLToPath(moduleUrl))
  } catch {
    return null
  }
}

function findBootstrapRoot(candidates: readonly LspCommandCandidate[], pathExists: (path: string) => boolean): string {
  return candidates.find((candidate) => pathExists(resolve(candidate.root, "package.json")))?.root ?? process.cwd()
}

function createBootstrapCandidate(root: string): LspCommandCandidate {
  return {
    command: ["node", "-e", LSP_BOOTSTRAP_SCRIPT, root],
    root,
    path: resolve(root, SUBMODULE_REL, DIST_CLI_REL),
    exists: true,
  }
}

function resolveLspCommand(options: LspMcpConfigOptions = {}): LspCommandCandidate {
  const pathExists = options.exists ?? existsSync
  const candidates: LspCommandCandidate[] = []
  const seenPaths = new Set<string>()
  const moduleDirectory = getModuleDirectory(options.moduleUrl ?? import.meta.url)

  if (moduleDirectory) {
    addAncestorCommandCandidates(moduleDirectory, candidates, seenPaths, pathExists)
  }

  addAncestorCommandCandidates(options.cwd ?? process.cwd(), candidates, seenPaths, pathExists)

  const distCandidate = candidates.find((candidate) => candidate.path.endsWith(DIST_CLI_REL) && candidate.exists)
  if (distCandidate) {
    return distCandidate
  }

  const sourceCandidate = candidates.find((candidate) => candidate.path.endsWith(SOURCE_CLI_REL) && candidate.exists)
  if (sourceCandidate) {
    return sourceCandidate
  }

  return createBootstrapCandidate(findBootstrapRoot(candidates, pathExists))
}

export function createLspMcpConfig(options: LspMcpConfigOptions = {}): LocalMcpConfig {
  const resolvedCommand = resolveLspCommand(options)

  return {
    type: "local",
    command: resolvedCommand.command,
    enabled: resolvedCommand.exists,
    environment: {
      LSP_TOOLS_MCP_PROJECT_CONFIG: PROJECT_LSP_CONFIG,
    },
  }
}
