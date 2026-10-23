import { readFileSync } from "node:fs"
import { join } from "node:path"

import { resolveAgentHome, type AgentHomeEnv } from "../../agent-home/resolve-agent-home"

/** The credential files, already parsed. Injected so tests never touch a home directory. */
export interface UsageCredentialSource {
  readonly auth: unknown
  readonly pool: unknown
}

/**
 * Reads the engine's own credential files.
 *
 * This component runs only inside Senpi, so OpenCode's data directory and `OPENCODE_AUTH_PATH`
 * do not apply here. The subscription credentials belong to Senpi's resolved agent directory.
 *
 * The host's generic key resolver normalises a credential and drops the per-account slots, and
 * those slots are exactly what decides which account is serving - so the files are the reliable
 * source here. Only names and health are read from them; the numbers come from the engine. They are
 * re-read on every limits report and turn rather than cached, because the pool fails over between turns.
 */
export function createCredentialReader(env: AgentHomeEnv = process.env): () => UsageCredentialSource {
  const home = resolveAgentHome({ env })
  return () => ({
    auth: readJson(join(home, "auth.json")),
    pool: readJson(join(home, "credential-pool-state.json")),
  })
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    // Missing or unreadable: the caller treats it as "no credential", not as an error to show.
    return undefined
  }
}
