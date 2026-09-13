import { readFileSync } from "node:fs"
import { join } from "node:path"

import { resolveAgentHome, type AgentHomeEnv } from "../../agent-home/resolve-agent-home"
import type { UsageCredentialSource } from "./poller"

/**
 * Reads the engine's own credential files.
 *
 * The host's generic key resolver normalises a credential and drops the per-account slots, and
 * those slots are exactly what decides which account is serving - so the files are the reliable
 * source here. They are re-read every poll rather than cached: tokens refresh and the pool fails
 * over between polls, and two small reads every couple of minutes cost nothing.
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
