import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const SUBMODULE_REL = "packages/lsp-tools-mcp"
const CLI_REL = "dist/cli.js"
const PROJECT_LSP_CONFIG = ".opencode/lsp.json"

export type LocalMcpConfig = {
  type: "local"
  command: string[]
  enabled: boolean
  environment?: Record<string, string>
}

function addCliPathCandidates(startDirectory: string, maxParentDepth: number, target: Set<string>): void {
  let currentDirectory = startDirectory

  for (let depth = 0; depth <= maxParentDepth; depth += 1) {
    target.add(resolve(currentDirectory, SUBMODULE_REL, CLI_REL))

    const parentDirectory = resolve(currentDirectory, "..")
    if (parentDirectory === currentDirectory) {
      return
    }

    currentDirectory = parentDirectory
  }
}

function resolveLspCliPathCandidates(): string[] {
  const candidates = new Set<string>()

  try {
    const currentFilePath = fileURLToPath(import.meta.url)
    const currentDirectory = resolve(currentFilePath, "..")
    addCliPathCandidates(currentDirectory, 6, candidates)
  } catch {
    // ignore and fall through to cwd-based candidates
  }

  addCliPathCandidates(process.cwd(), 4, candidates)

  return [...candidates]
}

export function createLspMcpConfig(): LocalMcpConfig | null {
  const cliPath = resolveLspCliPathCandidates().find((candidatePath) => existsSync(candidatePath))

  if (!cliPath) {
    return null
  }

  return {
    type: "local",
    command: ["node", cliPath, "mcp"],
    enabled: true,
    environment: {
      LSP_TOOLS_MCP_PROJECT_CONFIG: PROJECT_LSP_CONFIG,
    },
  }
}
