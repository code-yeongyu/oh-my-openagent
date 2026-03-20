import { getAllServers } from "../../../tools/lsp/config"

export function getInstalledLspServers(): Array<{ id: string; extensions: string[] }> {
  const servers = getAllServers()

  return servers
    .filter((s) => s.installed && !s.disabled)
    .map((s) => ({ id: s.id, extensions: s.extensions }))
}
