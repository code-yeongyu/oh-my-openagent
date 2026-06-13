import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { AlwaysOnUtilityToolName } from "../../host-tools"

export const PI_HERMES_OWNED_TOOL_NAMES = ["skill", "session_search"] as const satisfies readonly AlwaysOnUtilityToolName[]

type PiSettings = {
  packages?: unknown[]
}

type HermesInteroperabilityOptions = {
  agentDir?: string
  cwd?: string
  exists?: (path: string) => boolean
  readText?: (path: string) => string
}

function packageSource(value: unknown): string | undefined {
  if (typeof value === "string") return value
  if (typeof value !== "object" || value === null) return undefined
  if ("source" in value && typeof value.source === "string") return value.source
  return undefined
}

function settingsConfigureHermes(path: string, exists: (path: string) => boolean, readText: (path: string) => string): boolean {
  if (!exists(path)) return false
  try {
    const settings = JSON.parse(readText(path)) as PiSettings
    return settings.packages?.some((entry) => {
      const source = packageSource(entry)
      return source === "npm:pi-hermes-memory" || source === "pi-hermes-memory"
    }) ?? false
  } catch {
    return false
  }
}

export function isPiHermesMemoryEnabled(options: HermesInteroperabilityOptions = {}): boolean {
  const agentDir = options.agentDir ?? process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent")
  const cwd = options.cwd ?? process.cwd()
  const exists = options.exists ?? existsSync
  const readText = options.readText ?? ((path) => readFileSync(path, "utf8"))
  const installedManifest = join(agentDir, "npm", "node_modules", "pi-hermes-memory", "package.json")

  if (!exists(installedManifest)) return false

  return [
    join(agentDir, "settings.json"),
    join(cwd, ".pi", "settings.json"),
  ].some((path) => settingsConfigureHermes(path, exists, readText))
}

export function resolvePiHermesOwnedToolNames(options: HermesInteroperabilityOptions = {}): readonly AlwaysOnUtilityToolName[] {
  return isPiHermesMemoryEnabled(options) ? PI_HERMES_OWNED_TOOL_NAMES : []
}
