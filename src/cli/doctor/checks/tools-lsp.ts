import type { LspServerInfo } from "../types"
import { isServerInstalled } from "../../../tools/lsp/config"

const DEFAULT_LSP_SERVERS: Array<{ id: string; binary: string; extensions: string[] }> = [
  { id: "typescript-language-server", binary: "typescript-language-server", extensions: [".ts", ".tsx", ".js", ".jsx"] },
  { id: "pyright", binary: "pyright-langserver", extensions: [".py"] },
  { id: "rust-analyzer", binary: "rust-analyzer", extensions: [".rs"] },
  { id: "gopls", binary: "gopls", extensions: [".go"] },
]

export function getLspServersInfo(): LspServerInfo[] {
  return DEFAULT_LSP_SERVERS.map((server) => ({
    id: server.id,
    installed: isServerInstalled([server.binary]),
    extensions: server.extensions,
    source: "builtin",
  }))
}

export function getLspServerStats(servers: LspServerInfo[]): { installed: number; total: number } {
  return {
    installed: servers.filter((server) => server.installed).length,
    total: servers.length,
  }
}
