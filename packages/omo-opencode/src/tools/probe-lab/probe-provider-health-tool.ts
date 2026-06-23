import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import type { ProbeLabContext } from "../../features/probe-lab/probe-lab-context"

const DESCRIPTION = `Check health of one or all registered providers. Each provider's adapter calls its healthCheck() (typically GET /v1/models or equivalent). Returns per-provider status plus a summary.`

const PROVIDER_ID_DESC = "Specific provider id; omit to check all"
const FORCE_CHECK_DESC = "Bypass any cache (currently no-op; v0.3 will add result caching)"

export function createProbeProviderHealthTool(ctx: ProbeLabContext): ToolDefinition {
  const registry = ctx.providerRegistry
  return tool({
    description: DESCRIPTION,
    args: {
      provider_id: tool.schema.string().optional().describe(PROVIDER_ID_DESC),
      force_check: tool.schema.boolean().default(false).describe(FORCE_CHECK_DESC),
    },
    async execute(args) {
      try {
        registry.loadAll()
        const targets = args.provider_id
          ? [registry.get(args.provider_id)].filter((p): p is NonNullable<typeof p> => p != null)
          : registry.list()
        if (args.provider_id && targets.length === 0) {
          return `[ERROR] provider not found or unsupported provider_type: ${args.provider_id}`
        }
        const results = await Promise.all(targets.map(async (p) => {
          const credentials = ctx.store.getProvider(p.id)
          const health = await p.healthCheck()
          return {
            provider_id: p.id,
            provider_name: credentials?.name ?? p.id,
            kind: p.kind,
            ok: health.ok,
            status_code: health.status_code ?? null,
            message: health.message,
            checked_at: health.checked_at,
          }
        }))
        const degraded = results.filter((r) => !r.ok).length
        return JSON.stringify({
          providers: results,
          total_providers: results.length,
          degraded_providers: degraded,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return `[ERROR] probe_provider_health failed: ${message}`
      }
    },
  })
}
