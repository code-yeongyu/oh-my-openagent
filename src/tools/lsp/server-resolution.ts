import { BUILTIN_SERVERS, LSP_INSTALL_HINTS } from "./constants"
import { getConfigPaths, getMergedServers, loadAllConfigs } from "./server-config-loader"
import { isServerInstalled } from "./server-installation"
import type { ServerLookupResult } from "./types"

export function findServerForExtension(ext: string): ServerLookupResult {
  const servers = getMergedServers()

  for (const server of servers) {
    if (server.extensions.includes(ext) && isServerInstalled(server.command)) {
      return {
        status: "found",
        server: {
          id: server.id,
          command: server.command,
          extensions: server.extensions,
          priority: server.priority,
          env: server.env,
          initialization: server.initialization,
        },
      }
    }
  }

  for (const server of servers) {
    if (server.extensions.includes(ext)) {
      const installHint = LSP_INSTALL_HINTS[server.id] || `Install '${server.command[0]}' and ensure it's in your PATH`
      return {
        status: "not_installed",
        server: {
          id: server.id,
          command: server.command,
          extensions: server.extensions,
        },
        installHint,
      }
    }
  }

  const availableServers = [...new Set(servers.map((s) => s.id))]
  return {
    status: "not_configured",
    extension: ext,
    availableServers,
  }
}

export function getAllServers(): Array<{
  id: string
  installed: boolean
  extensions: string[]
  disabled: boolean
  source: string
  priority: number
}> {
  const configs = loadAllConfigs()
  const servers = getMergedServers()
  const disabled = new Set<string>()

  for (const config of configs.values()) {
    if (!config.lsp) continue
    for (const [id, entry] of Object.entries(config.lsp)) {
      if (entry.disabled) disabled.add(id)
    }
  }

  const result: Array<{
    id: string
    installed: boolean
    extensions: string[]
    disabled: boolean
    source: string
    priority: number
  }> = []

  const seen = new Set<string>()

  for (const server of servers) {
    if (seen.has(server.id)) continue
    result.push({
      id: server.id,
      installed: isServerInstalled(server.command),
      extensions: server.extensions,
      disabled: false,
      source: server.source,
      priority: server.priority,
    })
    seen.add(server.id)
  }

  for (const id of disabled) {
    if (seen.has(id)) continue
    const builtin = BUILTIN_SERVERS[id]
    result.push({
      id,
      installed: builtin ? isServerInstalled(builtin.command) : false,
      extensions: builtin?.extensions || [],
      disabled: true,
      source: "disabled",
      priority: 0,
    })
  }

  return result
}

export function getConfigPaths_(): { project: string; user: string; opencode: string } {
  return getConfigPaths()
}
