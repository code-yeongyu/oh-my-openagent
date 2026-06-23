import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import type { ProbeLabContext } from "../../features/probe-lab/probe-lab-context"

export function createProbeAuditLogTool(ctx: ProbeLabContext): ToolDefinition {
  return tool({
    description: "Query probe-lab audit_log with filters and pagination.",
    args: {
      entity_type: tool.schema.enum(["hypothesis", "evidence", "identity", "provider", "fingerprint", "canary"]).optional(),
      entity_id: tool.schema.string().optional(),
      action: tool.schema.string().optional(),
      since: tool.schema.number().optional(),
      until: tool.schema.number().optional(),
      limit: tool.schema.number().int().min(1).max(500).default(50),
      offset: tool.schema.number().int().min(0).default(0),
    },
    async execute(args) {
      try {
        const page = ctx.store.listAuditLog(args)
        return JSON.stringify({
          entries: page.entries,
          total_count: page.total,
          has_more: args.offset + page.entries.length < page.total,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return `[ERROR] probe_audit_log failed: ${message}`
      }
    },
  })
}
