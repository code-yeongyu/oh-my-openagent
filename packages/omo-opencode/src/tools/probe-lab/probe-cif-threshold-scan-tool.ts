import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { runCifThresholdScan } from "../../features/probe-lab/experiments/cif-threshold-experiment"
import type { ProbeLabContext } from "../../features/probe-lab/probe-lab-context"
import { isGlobalKillSwitchActive } from "./probe-kill-switch"

const DESCRIPTION = `Scan DeepSeek (or any /api/v0/chat/completion provider) at varying prompt sizes to map the CIF (Current Input File) kill-switch threshold.

Sends a deterministic prompt of each requested size through the provider's adapter (PoW solved automatically when auto_solve_pow is set), records each exchange in the probe-lab ledger, and returns observed behavior change points.

Pacing defaults to 8000ms between probes to avoid rate limiting. Default fresh chat session per probe to avoid context-history leakage between sizes.`

const SIZES_DESC = "Prompt sizes (chars) to probe, in execution order. Each probe is recorded as a separate exchange."
const PROVIDER_DESC = "Provider id (must be deepseek_web with auto_solve_pow=true for live runs)."
const HYPOTHESIS_DESC = "Hypothesis id to attach the resulting exchanges/sessions to."
const TEMPLATE_DESC = "Optional repeating prompt template (default: 'The quick brown fox jumps over the lazy dog. ')."
const PACE_DESC = "Milliseconds between probes (default 8000). Lower values risk rate limiting."
const LABEL_DESC = "Base label used for probe-lab session naming (default cif-scan-<ts>)."
const FRESH_DESC = "Whether to create a new chat_session per probe (default true; recommended for clean signal)."

export function createProbeCifThresholdScanTool(ctx: ProbeLabContext): ToolDefinition {
  return tool({
    description: DESCRIPTION,
    args: {
      provider_id: tool.schema.string().describe(PROVIDER_DESC),
      hypothesis_id: tool.schema.string().describe(HYPOTHESIS_DESC),
      sizes: tool.schema.array(tool.schema.number().int().positive()).min(1).max(64).describe(SIZES_DESC),
      prompt_template: tool.schema.string().optional().describe(TEMPLATE_DESC),
      pace_ms: tool.schema.number().int().min(0).max(60_000).default(8000).describe(PACE_DESC),
      session_label_base: tool.schema.string().optional().describe(LABEL_DESC),
      fresh_session_per_probe: tool.schema.boolean().default(true).describe(FRESH_DESC),
    },
    async execute(args) {
      try {
        if (isGlobalKillSwitchActive(ctx)) {
          return "[ERROR] global_kill_switch is active; probe_cif_threshold_scan rejected. Disable via probe_lab_config to resume."
        }
        const result = await runCifThresholdScan(ctx, {
          provider_id: args.provider_id,
          hypothesis_id: args.hypothesis_id,
          sizes: args.sizes,
          prompt_template: args.prompt_template,
          pace_ms: args.pace_ms,
          session_label_base: args.session_label_base,
          fresh_session_per_probe: args.fresh_session_per_probe,
        })
        return JSON.stringify({
          exchange_ids: result.exchange_ids,
          sizes_tested: result.outcomes.map((o) => o.size_chars),
          threshold_estimate: result.threshold_estimate,
          behavior_changes_at: result.behavior_changes_at,
          aborted: result.aborted,
          abort_reason: result.abort_reason,
          outcomes: result.outcomes.map((o) => ({
            size: o.size_chars,
            exchange_id: o.exchange_id,
            status: o.status,
            total_ms: o.total_ms,
            sse_events: o.sse_event_count,
            data_chunks: o.data_chunk_count,
            content_chars: o.content_chars,
            token_usage: o.token_usage,
            terminal_status: o.terminal_status,
            completed_normally: o.completed_normally,
            empty_sse: o.empty_sse,
            error: o.error_message,
          })),
        })
      } catch (err) {
        return `[ERROR] probe_cif_threshold_scan failed: ${err instanceof Error ? err.message : String(err)}`
      }
    },
  })
}
