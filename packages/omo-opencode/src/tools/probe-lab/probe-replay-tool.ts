import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import type { ProbeLabContext } from "../../features/probe-lab/probe-lab-context"
import { executeReplay } from "../../features/probe-lab/replay-executor"
import { isGlobalKillSwitchActive } from "./probe-kill-switch"

export function createProbeReplayTool(ctx: ProbeLabContext): ToolDefinition {
  return tool({
    description: "Replay a stored exchange with optional header and body modifications. Engine dispatch (camoufox/curl_cffi) honors the fingerprint profile when provided.",
    args: {
      exchange_id: tool.schema.number().int(),
      fingerprint_profile_id: tool.schema.string().optional(),
      identity_id: tool.schema.string().optional(),
      modify: tool.schema.object({
        headers_add: tool.schema.record(tool.schema.string(), tool.schema.string()).optional(),
        headers_remove: tool.schema.array(tool.schema.string()).optional(),
        header_values_override: tool.schema.record(tool.schema.string(), tool.schema.string()).optional(),
        body_transform: tool.schema.enum(["none", "strip_cif", "preserve_only_user_message"]).optional(),
      }).optional(),
      session_label: tool.schema.string().optional(),
    },
    async execute(args) {
      try {
        if (isGlobalKillSwitchActive(ctx)) {
          return "[ERROR] global_kill_switch is active; probe_replay rejected. Disable via probe_lab_config to resume."
        }
        const result = await executeReplay({
          ctx,
          exchangeId: args.exchange_id,
          modify: args.modify,
          fingerprintProfileId: args.fingerprint_profile_id,
          sessionLabel: args.session_label,
        })
        return JSON.stringify({
          exchange_id: result.exchange_id,
          original_exchange_id: result.original_exchange_id,
          evidence_id: result.evidence_id,
          status: result.status,
          timing_ms: result.timing_ms,
          differences: { status_changed: result.status_changed, body_changed: result.body_changed },
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return `[ERROR] probe_replay failed: ${message}`
      }
    },
  })
}
