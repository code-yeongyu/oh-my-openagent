import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Credential gate for the openference provider, mirroring the x-search pattern:
 * either the `OPENFERENCE_API_KEY` env var holds a non-empty value, or the
 * engine's `<agentDir>/auth.json` carries an `openference` login entry.
 *
 * The auth.json entry check stays shape-tolerant on purpose: the engine owns the
 * file and its entry shape (type/apiKey fields) varies by login flow, while the
 * component only needs to know the user ever authenticated with openference.
 */
export function hasOpenferenceCredential({
  agentDir,
  env = process.env,
}: {
  agentDir: string
  env?: Record<string, string | undefined>
}): boolean {
  if (env.OPENFERENCE_API_KEY?.trim()) return true

  const path = join(agentDir, "auth.json")
  if (!existsSync(path)) return false
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
    const entry = parsed.openference
    if (entry === null || typeof entry !== "object") return false
    const record = entry as Record<string, unknown>
    return typeof record.type === "string" || typeof record.apiKey === "string"
  } catch {
    return false
  }
}
