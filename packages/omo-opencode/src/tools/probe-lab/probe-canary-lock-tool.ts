import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { createCanaryManager } from "../../features/probe-lab/canary-manager"
import type { ProbeLabContext } from "../../features/probe-lab/probe-lab-context"
import { enforceRbacGate } from "../../features/probe-lab/rbac/probe-rbac-gate"

export function createProbeCanaryLockTool(ctx: ProbeLabContext): ToolDefinition {
  return tool({
    description: "Manage canary identity locks, promotion, demotion, and canary tests.",
    args: {
      identity_id: tool.schema.string(),
      action: tool.schema.enum(["lock", "release", "canary_test", "promote", "demote"]),
      lock_reason: tool.schema.string().max(500).optional(),
      canary_test_url: tool.schema.string().url().optional(),
      tier: tool.schema.enum(["canary", "standard", "sacrificial"]).optional(),
      quarantine_duration_s: tool.schema.number().int().min(30).max(86400).optional(),
    },
    async execute(args) {
      try {
        enforceRbacGate(ctx, "probe_canary_lock")
        const identity = ctx.store.getIdentity(args.identity_id)
        if (!identity) return `[ERROR] identity not found: ${args.identity_id}`
        const manager = createCanaryManager({ store: ctx.store })
        const result = await applyAction(ctx, manager, args)
        return JSON.stringify({
          identity_id: args.identity_id,
          action: args.action,
          previous_status: identity.status,
          ...result,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return `[ERROR] probe_canary_lock failed: ${message}`
      }
    },
  })
}

async function applyAction(
  ctx: ProbeLabContext,
  manager: ReturnType<typeof createCanaryManager>,
  args: { identity_id: string; action: string; lock_reason?: string; canary_test_url?: string; tier?: string },
): Promise<{ new_status: string; canary_test_passed: boolean | null }> {
  if (args.action === "lock") {
    if (!ctx.store.getCanaryLockByIdentity(args.identity_id)) {
      ctx.store.insertCanaryLock({ identity_id: args.identity_id, locked_by: "probe_canary_lock", lock_reason: args.lock_reason ?? "manual", canary_test_url: args.canary_test_url ?? null })
    }
    return { new_status: "locked", canary_test_passed: null }
  }
  if (args.action === "release") {
    ctx.store.releaseCanaryLock(args.identity_id)
    return { new_status: "released", canary_test_passed: null }
  }
  if (args.action === "promote") {
    ctx.store.setIdentityTier(args.identity_id, args.tier ?? "canary")
    return { new_status: "promoted", canary_test_passed: null }
  }
  if (args.action === "demote") {
    ctx.store.setIdentityTier(args.identity_id, args.tier ?? "standard")
    return { new_status: "demoted", canary_test_passed: null }
  }
  const outcome = await manager.runCanaryTest(args.identity_id)
  return { new_status: outcome, canary_test_passed: outcome === "pass" }
}
