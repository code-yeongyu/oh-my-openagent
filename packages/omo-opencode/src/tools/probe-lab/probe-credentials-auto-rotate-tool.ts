import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { evaluateAutoRotationTriggers, type AutoRotationTrigger } from "../../features/probe-lab/credential-rotation/auto-rotation-policy"
import type { ProbeLabContext } from "../../features/probe-lab/probe-lab-context"
import { enforceRbacGate } from "../../features/probe-lab/rbac/probe-rbac-gate"
import { createProbeProviderRotateTool } from "./probe-provider-rotate-tool"
import { createProbeProviderRefreshTool } from "./probe-provider-refresh-tool"

type ExecutionOutcome = {
  provider_id: string
  action: "rotate" | "refresh"
  invoked_tool: "probe_provider_rotate" | "probe_provider_refresh"
  result: string
}

export function createProbeCredentialsAutoRotateTool(ctx: ProbeLabContext): ToolDefinition {
  return tool({
    description: "Evaluate auto-rotation triggers (credential expiry, consecutive 401s) and emit recommended rotations or refreshes. Set apply=true to record audit_log entries. Set execute=true to actually invoke probe_provider_rotate / probe_provider_refresh for each trigger.",
    args: {
      apply: tool.schema.boolean().default(false),
      execute: tool.schema.boolean().default(false),
    },
    async execute(args) {
      try {
        enforceRbacGate(ctx, "probe_credentials_auto_rotate")
        const triggers = evaluateAutoRotationTriggers({ store: ctx.store })
        if (args.apply) recordRecommendations(ctx, triggers)
        const executions = args.execute ? await runExecutions(ctx, triggers) : []
        if (args.execute) recordExecutions(ctx, executions)
        return JSON.stringify({ triggers, applied: args.apply, executed: args.execute, executions })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return `[ERROR] probe_credentials_auto_rotate failed: ${message}`
      }
    },
  })
}

function recordRecommendations(ctx: ProbeLabContext, triggers: AutoRotationTrigger[]): void {
  for (const trigger of triggers) {
    ctx.store.insertAuditLog({
      entity_type: "provider",
      entity_id: trigger.provider_id,
      action: "auto_rotate_recommended",
      reason: trigger.reason,
      changes: { action: trigger.action, rotation_type: trigger.rotation_type, refresh_type: trigger.refresh_type },
    })
  }
}

async function runExecutions(ctx: ProbeLabContext, triggers: AutoRotationTrigger[]): Promise<ExecutionOutcome[]> {
  const rotateTool = createProbeProviderRotateTool(ctx)
  const refreshTool = createProbeProviderRefreshTool(ctx)
  const out: ExecutionOutcome[] = []
  for (const trigger of triggers) {
    if (trigger.action === "rotate" && trigger.rotation_type) {
      const result = await rotateTool.execute(
        { provider_id: trigger.provider_id, rotation_type: trigger.rotation_type, reason: trigger.reason },
        { sessionID: "auto-rotate" } as never,
      )
      out.push({ provider_id: trigger.provider_id, action: "rotate", invoked_tool: "probe_provider_rotate", result: typeof result === "string" ? result : JSON.stringify(result) })
      continue
    }
    if (trigger.action === "refresh" && trigger.refresh_type) {
      const result = await refreshTool.execute(
        { provider_id: trigger.provider_id, refresh_type: trigger.refresh_type },
        { sessionID: "auto-rotate" } as never,
      )
      out.push({ provider_id: trigger.provider_id, action: "refresh", invoked_tool: "probe_provider_refresh", result: typeof result === "string" ? result : JSON.stringify(result) })
    }
  }
  return out
}

function recordExecutions(ctx: ProbeLabContext, executions: ExecutionOutcome[]): void {
  for (const exec of executions) {
    ctx.store.insertAuditLog({
      entity_type: "provider",
      entity_id: exec.provider_id,
      action: "auto_rotate_executed",
      reason: `auto-rotate executed via ${exec.invoked_tool}`,
      changes: { action: exec.action, invoked_tool: exec.invoked_tool, result_preview: exec.result.slice(0, 200) },
    })
  }
}
