import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import type { ProbeLabContext } from "../../features/probe-lab/probe-lab-context"

const DESCRIPTION = `Refresh credentials/cookies/tokens for a provider. Delegates to the provider adapter's refreshCredentials(refresh_type). For static-key providers (openai, anthropic) returns success: true with a no-op message. For cookie/oauth providers (deepseek_web) triggers actual refresh and persists the rotated value to provider auth_config when the adapter returns new_value + new_value_field.`

const PROVIDER_ID_DESC = "Provider id"
const REFRESH_TYPE_DESC = "What to refresh: credentials, cookies, token, aws_waf_token (deepseek_web), models, or all"

export function createProbeProviderRefreshTool(ctx: ProbeLabContext): ToolDefinition {
  const registry = ctx.providerRegistry
  return tool({
    description: DESCRIPTION,
    args: {
      provider_id: tool.schema.string().describe(PROVIDER_ID_DESC),
      refresh_type: tool.schema.enum(["credentials", "cookies", "token", "aws_waf_token", "models", "all"]).describe(REFRESH_TYPE_DESC),
    },
    async execute(args) {
      try {
        registry.loadAll()
        const provider = registry.get(args.provider_id)
        if (!provider) return `[ERROR] provider not found or unsupported provider_type: ${args.provider_id}`
        const result = await provider.refreshCredentials(args.refresh_type)
        let persisted = false
        if (result.success && result.new_value && result.new_value_field) {
          const creds = ctx.store.getProvider(args.provider_id)
          if (creds) {
            const current = parseAuthConfig(creds.auth_config)
            current[result.new_value_field] = result.new_value
            ctx.store.updateProviderAuthConfig(args.provider_id, current)
            persisted = true
          }
        }
        return JSON.stringify({
          provider_id: args.provider_id,
          refresh_type: args.refresh_type,
          success: result.success,
          new_expiry: result.new_expiry ?? null,
          message: result.message ?? null,
          persisted,
          new_value_field: result.new_value_field ?? null,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return `[ERROR] probe_provider_refresh failed: ${message}`
      }
    },
  })
}

function parseAuthConfig(json: string): Record<string, string> {
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") out[key] = value
      else if (typeof value === "number" || typeof value === "boolean") out[key] = String(value)
    }
    return out
  } catch {
    return {}
  }
}
