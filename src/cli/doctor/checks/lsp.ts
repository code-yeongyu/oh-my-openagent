import type { CheckResult, CheckDefinition, LspServerInfo } from "../types"
import { CHECK_IDS, CHECK_NAMES } from "../constants"

const DEFAULT_LSP_SERVERS: Array<{
  id: string
  binary: string
  extensions: string[]
}> = [
  { id: "typescript-language-server", binary: "typescript-language-server", extensions: [".ts", ".tsx", ".js", ".jsx"] },
  { id: "pyright", binary: "pyright-langserver", extensions: [".py"] },
  { id: "rust-analyzer", binary: "rust-analyzer", extensions: [".rs"] },
  { id: "gopls", binary: "gopls", extensions: [".go"] },
]

import { isServerInstalled } from "../../../tools/lsp/config"

export async function getLspServersInfo(): Promise<LspServerInfo[]> {
  const servers: LspServerInfo[] = []

  for (const server of DEFAULT_LSP_SERVERS) {
    const installed = isServerInstalled([server.binary])
    servers.push({
      id: server.id,
      installed,
      extensions: server.extensions,
      source: "builtin",
    })
  }

  return servers
}

export function getLspServerStats(servers: LspServerInfo[]): { installed: number; total: number } {
  const installed = servers.filter((s) => s.installed).length
  return { installed, total: servers.length }
}

export async function checkLspServers(): Promise<CheckResult> {
  const servers = await getLspServersInfo()
  const stats = getLspServerStats(servers)
  const installedServers = servers.filter((s) => s.installed)
  const missingServers = servers.filter((s) => !s.installed)

  if (stats.installed === 0) {
    return {
      name: CHECK_NAMES[CHECK_IDS.LSP_SERVERS],
      status: "warn",
      message: "No LSP servers detected",
      details: [
        "LSP tools will have limited functionality",
        ...missingServers.map((s) => `Missing: ${s.id}`),
      ],
    }
  }

  const details = [
    ...installedServers.map((s) => `Installed: ${s.id}`),
    ...missingServers.map((s) => `Not found: ${s.id} (optional)`),
  ]

  return {
    name: CHECK_NAMES[CHECK_IDS.LSP_SERVERS],
    status: "pass",
    message: `${stats.installed}/${stats.total} servers available`,
    details,
  }
}

export function getLspCheckDefinition(): CheckDefinition {
  return {
    id: CHECK_IDS.LSP_SERVERS,
    name: CHECK_NAMES[CHECK_IDS.LSP_SERVERS],
    category: "tools",
    check: checkLspServers,
    critical: false,
  }
}
