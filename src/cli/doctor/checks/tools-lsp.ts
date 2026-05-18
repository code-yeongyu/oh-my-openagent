import { createLspMcpConfig } from "../../../mcp/lsp"

export function getInstalledLspServers(): Array<{ id: string; extensions: string[] }> {
  const lspMcpConfig = createLspMcpConfig()

  if (!lspMcpConfig) {
    return []
  }

  return [{ id: "lsp-tools-mcp", extensions: ["*"] }]
}
