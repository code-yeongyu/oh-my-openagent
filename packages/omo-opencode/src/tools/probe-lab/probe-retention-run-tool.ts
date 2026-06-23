import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import type { ProbeLabContext } from "../../features/probe-lab/probe-lab-context"
import { enforceRbacGate } from "../../features/probe-lab/rbac/probe-rbac-gate"
import { runRetentionSweep } from "../../features/probe-lab/retention/retention-sweeper"

const RETENTION_LAST_RUN_KEY = "retention_last_run_at"

export function createProbeRetentionRunTool(ctx: ProbeLabContext): ToolDefinition {
  return tool({
    description: "Apply probe-lab retention windows: blanks probe_exchanges.response_body older than 90d, deletes audit_log older than 365d, deletes rate_limit_observations older than 30d, deletes captures older than 30d. Set dry_run=true to preview counts without mutating.",
    args: {
      dry_run: tool.schema.boolean().default(false),
    },
    async execute(args) {
      try {
        enforceRbacGate(ctx, "probe_retention_run")
        const result = runRetentionSweep({ store: ctx.store, dryRun: args.dry_run })
        if (!args.dry_run) {
          const now = Math.floor(Date.now() / 1000)
          ctx.store.setProbeLabConfig(RETENTION_LAST_RUN_KEY, String(now), "Last successful retention sweep timestamp (epoch seconds)")
          ctx.store.insertAuditLog({
            entity_type: "retention",
            entity_id: "global",
            action: "sweep",
            reason: "probe_retention_run",
            changes: result as unknown as Record<string, unknown>,
          })
        }
        return JSON.stringify({
          dry_run: args.dry_run,
          [args.dry_run ? "would_have_done" : "swept"]: result,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return `[ERROR] probe_retention_run failed: ${message}`
      }
    },
  })
}
