import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { runRateLimitScan } from "../../features/probe-lab/experiments/rate-limit-experiment"
import type { ProbeLabContext } from "../../features/probe-lab/probe-lab-context"
import type { RateScanInput } from "../../features/probe-lab/experiments/rate-limit-types"
import { isGlobalKillSwitchActive } from "./probe-kill-switch"

const DESCRIPTION = `Empirically map per-account rate-limit topology of chat.deepseek.com.

4 modes:
- sustained: pace N req/min for total_requests, abort on chat.is_muted=1
- burst: fire concurrency parallel completions in waves until total_requests reached
- token_volume: heavy-prompt scan to test token-vs-request gating
- recovery: poll /api/v0/users/current at supplied checkpoints to map mute-recovery curve

Records every probe in the probe-lab ledger with linkage to a hypothesis.
Mute watcher uses GET /api/v0/users/current; abort_on_mute defaults to true (safety gate).`

const PROVIDER_DESC = "Provider id (must be deepseek_web with auto_solve_pow=true for live runs)."
const HYPOTHESIS_DESC = "Hypothesis id to attach exchanges/sessions to."
const MODE_DESC = "Sub-test: sustained | burst | token_volume | recovery."

export function createProbeRateLimitScanTool(ctx: ProbeLabContext): ToolDefinition {
  return tool({
    description: DESCRIPTION,
    args: {
      provider_id: tool.schema.string().describe(PROVIDER_DESC),
      hypothesis_id: tool.schema.string().describe(HYPOTHESIS_DESC),
      mode: tool.schema.enum(["sustained", "burst", "token_volume", "recovery"]).describe(MODE_DESC),
      sustained: tool.schema
        .object({
          req_per_min: tool.schema.number().int().min(1).max(600),
          total_requests: tool.schema.number().int().min(1).max(500),
          prompt_chars: tool.schema.number().int().min(1).max(100_000).optional(),
          prompt_template: tool.schema.string().optional(),
        })
        .optional(),
      burst: tool.schema
        .object({
          concurrency: tool.schema.number().int().min(1).max(50),
          total_requests: tool.schema.number().int().min(1).max(500),
          prompt_chars: tool.schema.number().int().min(1).max(100_000).optional(),
          prompt_template: tool.schema.string().optional(),
        })
        .optional(),
      token_volume: tool.schema
        .object({
          prompt_sizes: tool.schema.array(tool.schema.number().int().positive()).min(1).max(20),
          count_per_size: tool.schema.number().int().min(1).max(20),
          pace_ms: tool.schema.number().int().min(0).max(120_000).optional(),
          prompt_template: tool.schema.string().optional(),
        })
        .optional(),
      recovery: tool.schema
        .object({
          checkpoints_seconds: tool.schema.array(tool.schema.number().int().min(1).max(86_400)).min(1).max(20),
        })
        .optional(),
      mute_check_interval_ms: tool.schema.number().int().min(1000).max(600_000).default(30_000),
      abort_on_mute: tool.schema.boolean().default(true),
      session_label_base: tool.schema.string().optional(),
    },
    async execute(args) {
      try {
        if (isGlobalKillSwitchActive(ctx)) {
          return "[ERROR] global_kill_switch is active; probe_rate_limit_scan rejected. Disable via probe_lab_config to resume."
        }
        const input: RateScanInput = {
          provider_id: args.provider_id,
          hypothesis_id: args.hypothesis_id,
          mode: args.mode,
          sustained: args.sustained,
          burst: args.burst,
          token_volume: args.token_volume,
          recovery: args.recovery,
          mute_check_interval_ms: args.mute_check_interval_ms,
          abort_on_mute: args.abort_on_mute,
          session_label_base: args.session_label_base,
        }
        const result = await runRateLimitScan(ctx, input)
        return JSON.stringify({
          mode: result.mode,
          exchange_ids: result.exchange_ids,
          summary: result.summary,
          mute_event: result.mute_event,
          mute_samples: result.mute_samples.map((s) => ({
            is_muted: s.is_muted,
            mute_until: s.mute_until,
            sampled_at: s.sampled_at,
          })),
          recovery_samples: result.recovery_samples.map((s) => ({
            elapsed_seconds: s.elapsed_seconds,
            is_muted: s.mute_state.is_muted,
            mute_until: s.mute_state.mute_until,
          })),
          aborted: result.aborted,
          abort_reason: result.abort_reason,
          outcomes: result.outcomes.map((o) => ({
            index: o.index,
            exchange_id: o.exchange_id,
            status: o.status,
            ttft_ms: o.ttft_ms,
            total_ms: o.total_ms,
            prompt_chars: o.prompt_chars,
            empty_sse: o.empty_sse,
            terminal_status: o.terminal_status,
            completed_normally: o.completed_normally,
            error: o.error_message,
          })),
        })
      } catch (err) {
        return `[ERROR] probe_rate_limit_scan failed: ${err instanceof Error ? err.message : String(err)}`
      }
    },
  })
}
