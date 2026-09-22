import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Credential gate for the openference provider, mirroring the x-search pattern:
 * either the `OPENFERENCE_API_KEY` env var holds a non-empty value, or the
 * engine's `<agentDir>/auth.json` carries an `openference` login entry.
 *
 * auth.json is engine-owned: `/login openference` writes one of the canonical
 * credential shapes (api_key or oauth), so the check accepts exactly those and
 * fails closed on anything else.
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
    const type = (entry as { type?: unknown }).type
    return type === "api_key" || type === "oauth"
  } catch {
    return false
  }
}
