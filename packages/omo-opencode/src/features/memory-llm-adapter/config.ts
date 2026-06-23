import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { ClaudeMemLlmAdapterConfig } from "./types"

const DEFAULT_HOST = "127.0.0.1"
const DEFAULT_PORT = 37999
const DEFAULT_ENDPOINT = "http://127.0.0.1:20128/v1/chat/completions"
const DEFAULT_PRIMARY_MODEL = "deepseek-v4-flash"
const DEFAULT_FALLBACK_MODEL = "deepseek-v4-flash"
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
const DEFAULT_CONFIG_FILE = join(homedir(), ".claude-mem", "opencode-go-config.json")
const DEFAULT_API_KEY_FILE = join(homedir(), ".claude-mem", "opencode-go.key")
const DEFAULT_PROVIDER_OVERRIDE: Record<string, unknown> = {
  order: ["opencode-free", "ocg", "di"],
}

type OpencodeGoConfigFile = {
  endpoint?: string
  apiKeyFile?: string
  model?: string
  fallbackModel?: string
}

export function resolveClaudeMemLlmAdapterConfig(
  env: Record<string, string | undefined> = process.env,
  configPath: string = DEFAULT_CONFIG_FILE,
): ClaudeMemLlmAdapterConfig {
  const fileCfg = readOpencodeGoConfigFile(configPath)
  const apiKey = resolveApiKey(env, fileCfg.apiKeyFile)
  if (!apiKey) {
    throw new Error(
      `CLAUDE_MEM_OPENCODE_GO_API_KEY env var (or apiKeyFile referenced by ${configPath}) is required for claude-mem adapter`,
    )
  }
  const primaryModel =
    env.CLAUDE_MEM_OPENCODE_GO_MODEL ?? fileCfg.model ?? DEFAULT_PRIMARY_MODEL
  const fallbackModel =
    env.CLAUDE_MEM_OPENCODE_GO_FALLBACK_MODEL ??
    fileCfg.fallbackModel ??
    primaryModel ??
    DEFAULT_FALLBACK_MODEL
  return {
    host: env.CLAUDE_MEM_ADAPTER_HOST ?? DEFAULT_HOST,
    port: parsePositiveInteger(env.CLAUDE_MEM_ADAPTER_PORT, DEFAULT_PORT),
    endpoint: env.CLAUDE_MEM_OPENCODE_GO_ENDPOINT ?? fileCfg.endpoint ?? DEFAULT_ENDPOINT,
    apiKey,
    primaryModel,
    fallbackModel,
    requestTimeoutMs: parsePositiveInteger(
      env.CLAUDE_MEM_ADAPTER_REQUEST_TIMEOUT_MS,
      DEFAULT_REQUEST_TIMEOUT_MS,
    ),
    authToken: env.CLAUDE_MEM_ADAPTER_TOKEN,
    providerOverride: resolveProviderOverride(env),
  }
}

function resolveProviderOverride(
  env: Record<string, string | undefined>,
): Record<string, unknown> | undefined {
  const raw = env.CLAUDE_MEM_LLM_PROVIDER_JSON
  if (raw === undefined) return DEFAULT_PROVIDER_OVERRIDE
  const trimmed = raw.trim()
  if (trimmed.length === 0 || trimmed === "null" || trimmed === "false") return undefined
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return undefined
  } catch {
    return undefined
  }
}

function readOpencodeGoConfigFile(path: string): OpencodeGoConfigFile {
  if (!existsSync(path)) return {}
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
    return {
      endpoint: stringField(parsed, "endpoint"),
      apiKeyFile: stringField(parsed, "apiKeyFile"),
      model: stringField(parsed, "model"),
      fallbackModel: stringField(parsed, "fallbackModel"),
    }
  } catch {
    return {}
  }
}

function resolveApiKey(
  env: Record<string, string | undefined>,
  apiKeyFile: string | undefined,
): string | undefined {
  const fromEnv = env.CLAUDE_MEM_OPENCODE_GO_API_KEY
  if (fromEnv && fromEnv.length > 0) return fromEnv
  const path = env.CLAUDE_MEM_OPENCODE_GO_API_KEY_FILE ?? apiKeyFile ?? DEFAULT_API_KEY_FILE
  if (!existsSync(path)) return undefined
  try {
    const contents = readFileSync(path, "utf8").trim()
    return contents.length > 0 ? contents : undefined
  } catch {
    return undefined
  }
}

function stringField(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}
