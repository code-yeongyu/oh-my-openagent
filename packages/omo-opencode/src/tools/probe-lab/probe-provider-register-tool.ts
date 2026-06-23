import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { randomUUID } from "node:crypto"
import type { ProbeLabContext } from "../../features/probe-lab/probe-lab-context"
import { enforceRbacGate } from "../../features/probe-lab/rbac/probe-rbac-gate"

const DESCRIPTION = `Register a new provider with credentials in probe-lab.

auth_config is encrypted at rest with AES-256-GCM before persistence. Set IDM_PROBE_LAB_MASTER_KEY to a 32-byte hex key for production deployments.

provider_type accepts: openai_compatible, anthropic, google, custom_http. Use the matching adapter (ds2api, openai_official, anthropic_official, deepseek_web) by setting name=<adapter-key> when wiring with the registry.`

const NAME_DESC = "Logical name (also used by registry to dispatch the right adapter)"
const PROVIDER_TYPE_DESC = "Provider archetype (openai_compatible | anthropic | google | custom_http)"
const BASE_URL_DESC = "Provider base URL"
const AUTH_TYPE_DESC = "Authentication mechanism"
const AUTH_CONFIG_DESC = "Auth credentials object (e.g. { bearer_token, api_key, cookie })"
const DEFAULT_HEADERS_DESC = "Headers attached to every probe"
const SUPPORTED_MODELS_DESC = "List of supported model identifiers"
const HEALTH_CHECK_URL_DESC = "Override URL for healthCheck()"

export function createProbeProviderRegisterTool(ctx: ProbeLabContext): ToolDefinition {
  return tool({
    description: DESCRIPTION,
    args: {
      name: tool.schema.string().min(1).describe(NAME_DESC),
      provider_type: tool.schema.enum([
        "openai_compatible",
        "anthropic",
        "google",
        "custom_http",
        "ds2api",
        "openai_official",
        "anthropic_official",
        "deepseek_web",
        "gemini_official",
        "opencode_go",
        "openrouter",
        "ollama_local",
        "claude_web_reverse",
        "gemini_web_reverse",
        "manus_web",
      ]).describe(PROVIDER_TYPE_DESC),
      base_url: tool.schema.string().url().describe(BASE_URL_DESC),
      auth_type: tool.schema.enum(["bearer_token", "api_key_header", "cookie_session", "oauth2", "none"]).describe(AUTH_TYPE_DESC),
      auth_config: tool.schema.record(tool.schema.string(), tool.schema.string()).describe(AUTH_CONFIG_DESC),
      default_headers: tool.schema.record(tool.schema.string(), tool.schema.string()).optional().describe(DEFAULT_HEADERS_DESC),
      rate_limit_rps: tool.schema.number().positive().optional(),
      supported_models: tool.schema.array(tool.schema.string()).optional().describe(SUPPORTED_MODELS_DESC),
      health_check_url: tool.schema.string().url().optional().describe(HEALTH_CHECK_URL_DESC),
    },
    async execute(args) {
      try {
        enforceRbacGate(ctx, "probe_provider_register")
        const id = `p-${randomUUID()}`
        const row = ctx.store.insertProvider({
          id,
          name: args.name,
          provider_type: args.provider_type,
          base_url: args.base_url,
          auth_type: args.auth_type,
          auth_config: args.auth_config,
          default_headers: args.default_headers ?? null,
          rate_limit_rps: args.rate_limit_rps ?? null,
          supported_models: args.supported_models ?? null,
          health_check_url: args.health_check_url ?? null,
        })
        return JSON.stringify({
          provider_id: row.id,
          name: row.name,
          status: row.status,
          encryption_status: "aes-256-gcm",
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return `[ERROR] probe_provider_register failed: ${message}`
      }
    },
  })
}
