import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export type DshAuth = {
  readonly apiKey?: string
  readonly baseUrl?: string
  readonly model?: string
}

export type ResolveDshAuthOptions = {
  readonly getApiKeyForProvider?: (provider: string) => string | undefined | Promise<string | undefined>
  readonly authPath?: string
  readonly readFile?: (path: string) => string
  readonly agentDir?: string
}

const DEFAULT_BASE_URL = "https://opencode.ai/zen/go/v1"
const DEFAULT_MODEL = "deepseek-v4-flash"

/**
 * Resolve dsh credentials for the native (senpi) route. Precedence:
 * 1. explicit DEEPSEEK_* / DSH_MODEL env vars
 * 2. an injected engine credential accessor (e.g. the senpi ExtensionContext
 *    modelRegistry's getApiKeyForProvider) for provider "opencode-go"
 * 3. the native auth store at <agentDir>/auth.json (default
 *    ~/.omo/agent/auth.json, override via OMO_AGENT_DIR), whose provider
 *    entries use type "api_key" (the opencode "api" spelling is also accepted).
 * Returns an empty object when nothing resolves.
 */
export async function resolveDshAuth(
  env: NodeJS.ProcessEnv = process.env,
  options: ResolveDshAuthOptions = {},
): Promise<DshAuth> {
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

  if (options.getApiKeyForProvider) {
    const engineKey = await options.getApiKeyForProvider("opencode-go")
    if (engineKey) {
      return {
        apiKey: engineKey,
        baseUrl: explicitBaseUrl ?? DEFAULT_BASE_URL,
        model: explicitModel ?? DEFAULT_MODEL,
      }
    }
  }

  const agentDir = options.agentDir ?? env.OMO_AGENT_DIR ?? join(homedir(), ".omo", "agent")
  const authPath = options.authPath ?? join(agentDir, "auth.json")
  try {
    const read = options.readFile ?? ((path: string) => readFileSync(path, "utf8"))
    const auth = JSON.parse(read(authPath)) as Record<string, { type?: string; key?: string }>
    const opencodeGo = auth["opencode-go"]
    if (
      opencodeGo &&
      (opencodeGo.type === "api_key" || opencodeGo.type === "api") &&
      typeof opencodeGo.key === "string" &&
      opencodeGo.key.length > 0
    ) {
      return {
        apiKey: opencodeGo.key,
        baseUrl: explicitBaseUrl ?? DEFAULT_BASE_URL,
        model: explicitModel ?? DEFAULT_MODEL,
      }
    }
  } catch {
    // fall through: no native auth available
  }
  return {}
}