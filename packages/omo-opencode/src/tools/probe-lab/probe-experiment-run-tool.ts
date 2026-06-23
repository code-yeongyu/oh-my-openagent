import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { createCanaryManager } from "../../features/probe-lab/canary-manager"
import type { ExperimentProtocolStep, ExperimentSafetyBudget } from "../../features/probe-lab/experiment-types"
import type { ProbeLabContext } from "../../features/probe-lab/probe-lab-context"
import { isGlobalKillSwitchActive } from "./probe-kill-switch"
import { createProbeRunTool } from "./probe-run-tool"

export function createProbeExperimentRunTool(ctx: ProbeLabContext): ToolDefinition {
  return tool({
    description: "Execute an experiment protocol with canary safety checks. Rejects when global_kill_switch is active before any status mutation.",
    args: {
      experiment_id: tool.schema.string(),
      dry_run: tool.schema.boolean().default(false),
      auto_evidence: tool.schema.boolean().default(true),
    },
    async execute(args) {
      if (isGlobalKillSwitchActive(ctx)) {
        return "[ERROR] global_kill_switch is active; probe_experiment_run rejected. Disable via probe_lab_config to resume."
      }
      const experiment = ctx.store.getExperiment(args.experiment_id)
      if (!experiment) return `[ERROR] experiment not found: ${args.experiment_id}`
      const safety = parseSafetyBudget(experiment.safety_budget)
      const canaries = createCanaryManager({ store: ctx.store }).getCanaryHealth()
      if (safety.require_canary && canaries.active_canary_count === 0) {
        ctx.store.insertAuditLog({
          entity_type: "experiment",
          entity_id: args.experiment_id,
          action: "abort_safety",
          reason: "require_canary=true but no active healthy canaries",
          changes: { canary_count: canaries.canary_count, active_canary_count: canaries.active_canary_count },
        })
        return `[ERROR] no active healthy canaries available; cannot run experiment with require_canary=true (have ${canaries.canary_count} canary-tier but none active+closed-circuit)`
      }
      if (args.dry_run) return JSON.stringify({ experiment_id: args.experiment_id, status: experiment.status, session_ids: [], safety_checks_passed: true })
      ctx.store.updateExperimentStatus(args.experiment_id, "running")
      const sessionIds = await runSteps(ctx, args.experiment_id, parseProtocol(experiment.protocol))
      ctx.store.updateExperimentStatus(args.experiment_id, "completed")
      return JSON.stringify({ experiment_id: args.experiment_id, status: "completed", session_ids: sessionIds, safety_checks_passed: true })
    },
  })
}

async function runSteps(ctx: ProbeLabContext, experimentId: string, steps: ExperimentProtocolStep[]): Promise<string[]> {
  const runTool = createProbeRunTool(ctx)
  const ids: string[] = []
  for (const step of steps) {
    if (step.action !== "probe_run") continue
    const resp = await runTool.execute({ ...step.params, experiment_id: experimentId }, { sessionID: "probe_experiment_run" } as never)
    if (typeof resp === "string" && resp.startsWith("[ERROR]")) throw new Error(resp)
    const parsed = JSON.parse(resp as string) as { session_id?: string }
    if (parsed.session_id) ids.push(parsed.session_id)
  }
  return ids
}

function parseProtocol(json: string): ExperimentProtocolStep[] {
  try {
    const parsed = JSON.parse(json) as ExperimentProtocolStep[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function parseSafetyBudget(json: string | null): ExperimentSafetyBudget {
  if (!json) return { max_identities_burned: 3, max_time_s: 300, require_canary: true }
  try {
    return { max_identities_burned: 3, max_time_s: 300, require_canary: true, ...JSON.parse(json) }
  } catch {
    return { max_identities_burned: 3, max_time_s: 300, require_canary: true }
  }
}
