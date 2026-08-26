import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

/**
 * Where the senpi engine keeps its agent state for the install we are attached to.
 *
 * The branded omo distribution stores that state under `~/.omo/agent`, while a standalone
 * engine keeps it under `~/.senpi/agent`. A pre-unification omo release wrote it FLAT under
 * `~/.omo`, so that layout is still detected as a fallback. Every layout can exist on the same
 * machine during the transition, so the location is resolved rather than assumed, and the
 * environment always wins over detection.
 */

export const AGENT_DIR_ENV_NAMES = [
  "OMO_CODING_AGENT_DIR",
  "SENPI_CODING_AGENT_DIR",
  "PI_CODING_AGENT_DIR",
] as const

/** Marker proving a directory really holds engine state rather than sharing its name. */
export const AGENT_HOME_SENTINEL = "settings.json"

export type AgentHomeEnv = Readonly<Record<string, string | undefined>>

export interface ResolveAgentHomeOptions {
  readonly env: AgentHomeEnv
  readonly homeDir?: string
  readonly exists?: (path: string) => boolean
}

export function resolveAgentHome(options: ResolveAgentHomeOptions): string {
  const { env, homeDir = homedir(), exists = existsSync } = options

  for (const name of AGENT_DIR_ENV_NAMES) {
    const configured = env[name]?.trim()
    if (configured) return resolve(configured)
  }

  const brandedHome = join(homeDir, ".omo")
  const canonical = join(brandedHome, "agent")
  if (exists(join(canonical, AGENT_HOME_SENTINEL))) return canonical
  if (exists(join(brandedHome, AGENT_HOME_SENTINEL))) return brandedHome

  return join(homeDir, ".senpi", "agent")
}
