import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const SUBMODULE_REL = "packages/lsp-tools-mcp"
const DIST_CLI_REL = "dist/cli.js"
const SOURCE_CLI_REL = "src/cli.ts"
const PROJECT_LSP_CONFIG = ".opencode/lsp.json"

type LspMcpConfigOptions = {
  readonly cwd?: string
  readonly moduleUrl?: string
  readonly exists?: (path: string) => boolean
}

type LspCommandCandidate = {
  readonly command: string[]
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
      target.push({ command: ["node", distCliPath, "mcp"], path: distCliPath, exists: pathExists(distCliPath) })
    }

    const sourceCliPath = resolve(currentDirectory, SUBMODULE_REL, SOURCE_CLI_REL)
    if (!seenPaths.has(sourceCliPath)) {
      seenPaths.add(sourceCliPath)
      target.push({ command: ["bun", sourceCliPath, "mcp"], path: sourceCliPath, exists: pathExists(sourceCliPath) })
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

function resolveLspCommand(options: LspMcpConfigOptions = {}): string[] {
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
    return distCandidate.command
  }

  const sourceCandidate = candidates.find((candidate) => candidate.path.endsWith(SOURCE_CLI_REL) && candidate.exists)
  if (sourceCandidate) {
    return sourceCandidate.command
  }

  return candidates[0]?.command ?? ["node", resolve(process.cwd(), SUBMODULE_REL, DIST_CLI_REL), "mcp"]
}

export function createLspMcpConfig(options: LspMcpConfigOptions = {}): LocalMcpConfig {
  return {
    type: "local",
    command: resolveLspCommand(options),
    enabled: true,
    environment: {
      LSP_TOOLS_MCP_PROJECT_CONFIG: PROJECT_LSP_CONFIG,
    },
  }
}
