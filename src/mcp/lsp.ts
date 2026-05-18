import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const SUBMODULE_REL = "vendor/lsp-tools-mcp"
const CLI_REL = "dist/cli.js"
const PROJECT_LSP_CONFIG = ".opencode/lsp.json"

export type LocalMcpConfig = {
  type: "local"
  command: string[]
  enabled: boolean
  environment?: Record<string, string>
}

function resolveLspCliPathCandidates(): string[] {
  const candidates: string[] = []

  try {
    const currentFilePath = fileURLToPath(import.meta.url)
    candidates.push(resolve(currentFilePath, "..", "..", "..", SUBMODULE_REL, CLI_REL))
    candidates.push(resolve(currentFilePath, "..", "..", SUBMODULE_REL, CLI_REL))
    candidates.push(resolve(currentFilePath, "..", SUBMODULE_REL, CLI_REL))
  } catch {
    // ignore and fall through to cwd-based candidate
  }

  candidates.push(resolve(process.cwd(), SUBMODULE_REL, CLI_REL))

  return candidates
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
