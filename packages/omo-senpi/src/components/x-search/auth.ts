import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

export interface XaiAuthRegistry {
  authStorage: { get(provider: string): unknown }
  getProviderAuth(provider: string): Promise<{ auth: { apiKey?: string; headers?: Record<string, string | null> } } | undefined>
}

export async function resolveXaiBearer({
  modelRegistry,
  env = process.env,
}: {
  modelRegistry: XaiAuthRegistry
  env?: Record<string, string | undefined>
}): Promise<{ bearer: string; provenance: "store" | "env" } | undefined> {
  const stored = modelRegistry.authStorage.get("xai")
  if (stored !== undefined) {
    try {
      const resolved = await modelRegistry.getProviderAuth("xai")
      const bearer = resolved?.auth.apiKey?.trim()
      return bearer ? { bearer, provenance: "store" } : undefined
    } catch {
      return undefined
    }
  }
  const bearer = env.XAI_API_KEY?.trim()
  return bearer ? { bearer, provenance: "env" } : undefined
}

export function hasXaiCredential({ agentDir, env = process.env }: { agentDir: string; env?: Record<string, string | undefined> }): boolean {
  const path = join(agentDir, "auth.json")
  if (!existsSync(path)) return Boolean(env.XAI_API_KEY?.trim())
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
    const entry = parsed.xai
    if (!entry || typeof entry !== "object") return false
    const type = (entry as { type?: unknown }).type
    return type === "oauth" || type === "api_key"
  } catch {
    return false
  }
}
