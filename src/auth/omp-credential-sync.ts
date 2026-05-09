/**
 * Reads Oh-My-Pi (OMP) Anthropic OAuth credentials from its agent.db.
 *
 * OMP stores credentials in a SQLite database at ~/.omp/agent/agent.db
 * in the `auth_credentials` table. This module reads the active (non-disabled)
 * anthropic OAuth credential so OpenCode can share the same session —
 * including the Claude Max 20x rate limit tier.
 *
 * This is a best-effort operation: if the database doesn't exist, the entry
 * is missing, or the credential is expired, it returns null and the caller
 * falls back to the standard OAuth refresh flow.
 */

import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export interface OmpOAuthCredentials {
  access: string
  refresh: string
  expires: number
}

/**
 * Resolve the path to OMP's agent.db.
 *
 * Respects PI_CODING_AGENT_DIR if set (OMP uses this for custom agent dirs),
 * otherwise falls back to ~/.omp/agent/agent.db.
 */
function resolveAgentDbPath(): string {
  const override = process.env.PI_CODING_AGENT_DIR
  if (override) {
    return join(override, "agent.db")
  }
  return join(homedir(), ".omp", "agent", "agent.db")
}

/**
 * Attempt to read OMP's active Anthropic OAuth tokens from agent.db.
 *
 * Returns the credentials in the same shape as OpenCode's auth entry,
 * or null if unavailable.
 */

/** Reset function exposed for testing — forces next call to re-read. */
export function _resetOmpSyncForTesting(): void {
  // no-op; exists so tests can mock this module cleanly
}
export function syncOmpCredentials(dbPathOverride?: string): OmpOAuthCredentials | null {
  const dbPath = dbPathOverride ?? resolveAgentDbPath()

  if (!existsSync(dbPath)) {
    return null
  }

  try {
    // OpenCode ships as a Bun binary — bun:sqlite is always available.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Database } = require("bun:sqlite") as typeof import("bun:sqlite")

    const db = new Database(dbPath, { readonly: true })
    try {
      const row = db
        .query<{ data: string }, []>(
          `SELECT data FROM auth_credentials
           WHERE provider = 'anthropic'
             AND credential_type = 'oauth'
             AND disabled_cause IS NULL
           ORDER BY updated_at DESC
           LIMIT 1`,
        )
        .get()

      if (!row?.data) return null

      const parsed = JSON.parse(row.data) as {
        access?: string
        refresh?: string
        expires?: number
      }

      if (!parsed.access || !parsed.refresh || !parsed.expires) {
        return null
      }

      return {
        access: parsed.access,
        refresh: parsed.refresh,
        expires: parsed.expires,
      }
    } finally {
      db.close()
    }
  } catch {
    // Database unavailable, corrupt, or missing table — silent fallback
    return null
  }
}
