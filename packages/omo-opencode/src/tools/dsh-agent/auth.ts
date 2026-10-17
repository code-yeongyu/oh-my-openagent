import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export type DshAuth = {
  readonly apiKey?: string
  readonly baseUrl?: string
  readonly model?: string
}

/**
 * Resolve dsh credentials: prefer explicit DEEPSEEK_* env, then the opencode-go
 * subscription key from opencode's auth store. opencode-go is an OpenAI
 * compatible endpoint (https://opencode.ai/zen/go/v1) whose terms permit use
 * from any agent; routing dsh through it avoids a separate DeepSeek platform
 * key.
 */
export function resolveDshAuth(env: NodeJS.ProcessEnv = process.env): DshAuth {
  const explicitKey = env.DEEPSEEK_API_KEY
  const explicitBaseUrl = env.DEEPSEEK_BASE_URL
  const explicitModel = env.DSH_MODEL
  if (explicitKey) {
    return {
      apiKey: explicitKey,
      baseUrl: explicitBaseUrl,
      model: explicitModel,
    }
  }

  const authPath = env.OPENCODE_AUTH_PATH ?? join(homedir(), ".local", "share", "opencode", "auth.json")
  try {
    const auth = JSON.parse(readFileSync(authPath, "utf8")) as Record<string, { type?: string; key?: string }>
    const opencodeGo = auth["opencode-go"]
    if (opencodeGo?.type === "api" && typeof opencodeGo.key === "string" && opencodeGo.key.length > 0) {
      return {
        apiKey: opencodeGo.key,
        baseUrl: explicitBaseUrl ?? "https://opencode.ai/zen/go/v1",
        model: explicitModel ?? "deepseek-v4-flash",
      }
    }
  } catch {
    // fall through: no opencode auth available
  }
  return {}
}
