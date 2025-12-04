import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { BUILTIN_SERVERS, EXT_TO_LANG } from "./constants"

export interface ResolvedServer {
  id: string
  command: string[]
  extensions: string[]
  env?: Record<string, string>
  initialization?: Record<string, unknown>
}

interface OpencodeJsonLspEntry {
  disabled?: boolean
  command?: string[]
  extensions?: string[]
  env?: Record<string, string>
  initialization?: Record<string, unknown>
}

interface OpencodeJson {
  lsp?: Record<string, OpencodeJsonLspEntry>
}

let cachedOpencodeConfig: OpencodeJson | null = null

function loadOpencodeJson(): OpencodeJson {
  if (cachedOpencodeConfig) return cachedOpencodeConfig

  const configPath = join(homedir(), ".config", "opencode", "opencode.json")
  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, "utf-8")
      cachedOpencodeConfig = JSON.parse(content) as OpencodeJson
      return cachedOpencodeConfig
    } catch {
    }
  }

  cachedOpencodeConfig = {}
  return cachedOpencodeConfig
}

function getDisabledServers(): Set<string> {
  const config = loadOpencodeJson()
  const disabled = new Set<string>()

  if (config.lsp) {
    for (const [id, entry] of Object.entries(config.lsp)) {
      if (entry.disabled) {
        disabled.add(id)
      }
    }
  }

  return disabled
}

function getUserLspServers(): Map<string, ResolvedServer> {
  const config = loadOpencodeJson()
  const servers = new Map<string, ResolvedServer>()

  if (config.lsp) {
    for (const [id, entry] of Object.entries(config.lsp)) {
      if (entry.disabled) continue
      if (!entry.command || !entry.extensions) continue

      servers.set(id, {
        id,
        command: entry.command,
        extensions: entry.extensions,
        env: entry.env,
        initialization: entry.initialization,
      })
    }
  }

  return servers
}

export function findServerForExtension(ext: string): ResolvedServer | null {
  const userServers = getUserLspServers()
  const disabledServers = getDisabledServers()

  for (const server of userServers.values()) {
    if (server.extensions.includes(ext) && isServerInstalled(server.command)) {
      return server
    }
  }

  for (const [id, config] of Object.entries(BUILTIN_SERVERS)) {
    if (disabledServers.has(id)) continue
    if (userServers.has(id)) continue

    if (config.extensions.includes(ext) && isServerInstalled(config.command)) {
      return {
        id,
        command: config.command,
        extensions: config.extensions,
      }
    }
  }

  return null
}

export function getLanguageId(ext: string): string {
  return EXT_TO_LANG[ext] || "plaintext"
}

export function isServerInstalled(command: string[]): boolean {
  if (command.length === 0) return false

  const cmd = command[0]
  const pathEnv = process.env.PATH || ""
  const paths = pathEnv.split(":")

  for (const p of paths) {
    if (existsSync(join(p, cmd))) {
      return true
    }
  }

  return false
}

export function getAllServers(): Array<{ id: string; installed: boolean; extensions: string[]; disabled: boolean }> {
  const result: Array<{ id: string; installed: boolean; extensions: string[]; disabled: boolean }> = []
  const userServers = getUserLspServers()
  const disabledServers = getDisabledServers()
  const seen = new Set<string>()

  for (const server of userServers.values()) {
    result.push({
      id: server.id,
      installed: isServerInstalled(server.command),
      extensions: server.extensions,
      disabled: false,
    })
    seen.add(server.id)
  }

  for (const id of disabledServers) {
    if (seen.has(id)) continue
    const builtin = BUILTIN_SERVERS[id]
    result.push({
      id,
      installed: builtin ? isServerInstalled(builtin.command) : false,
      extensions: builtin?.extensions || [],
      disabled: true,
    })
    seen.add(id)
  }

  for (const [id, config] of Object.entries(BUILTIN_SERVERS)) {
    if (seen.has(id)) continue

    result.push({
      id,
      installed: isServerInstalled(config.command),
      extensions: config.extensions,
      disabled: false,
    })
  }

  return result
}
