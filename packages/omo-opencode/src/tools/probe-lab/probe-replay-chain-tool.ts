import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import type { ProbeLabContext } from "../../features/probe-lab/probe-lab-context"
import {
  executeReplay,
  type ReplayModify,
  type ReplayPersistedResult,
} from "../../features/probe-lab/replay-executor"
import { isGlobalKillSwitchActive } from "./probe-kill-switch"

type ChainEntry = {
  label: string
  modify: ReplayModify
}

type ChainRow = {
  label: string
  result: ReplayPersistedResult
  changed_behavior: boolean
}

export function createProbeReplayChainTool(ctx: ProbeLabContext): ToolDefinition {
  return tool({
    description: "Replay a stored exchange with multiple modifications. Each modification produces its own replay exchange. When auto_compare=true, returns a matrix flagging which modifications changed status or body relative to baseline.",
    args: {
      exchange_id: tool.schema.number().int(),
      modifications: tool.schema.array(tool.schema.object({
        label: tool.schema.string().min(1),
        modify: tool.schema.object({
          headers_add: tool.schema.record(tool.schema.string(), tool.schema.string()).optional(),
          headers_remove: tool.schema.array(tool.schema.string()).optional(),
          header_values_override: tool.schema.record(tool.schema.string(), tool.schema.string()).optional(),
          body_transform: tool.schema.enum(["none", "strip_cif", "preserve_only_user_message"]).optional(),
        }),
      })).min(1).max(20),
      identity_id: tool.schema.string().optional(),
      session_label: tool.schema.string().optional(),
      auto_compare: tool.schema.boolean().default(true),
    },
    async execute(args) {
      try {
        if (isGlobalKillSwitchActive(ctx)) {
          return "[ERROR] global_kill_switch is active; probe_replay_chain rejected. Disable via probe_lab_config to resume."
        }
        const baseline = await executeReplay({ ctx, exchangeId: args.exchange_id, sessionLabel: args.session_label })
        const rows: ChainRow[] = []
        for (const entry of args.modifications as ChainEntry[]) {
          const row = await runChainEntry(ctx, args, entry, baseline)
          rows.push(row)
        }
        return JSON.stringify({
          baseline_exchange_id: baseline.exchange_id,
          original_exchange_id: baseline.original_exchange_id,
          results: rows,
          summary: {
            modifications_that_changed_behavior: rows.filter((r) => r.changed_behavior).length,
            total: rows.length,
          },
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return `[ERROR] probe_replay_chain failed: ${message}`
      }
    },
  })
}

async function runChainEntry(
  ctx: ProbeLabContext,
  args: { exchange_id: number; session_label?: string; auto_compare: boolean },
  entry: ChainEntry,
  baseline: ReplayPersistedResult,
): Promise<ChainRow> {
  const result = await executeReplay({
    ctx,
    exchangeId: args.exchange_id,
    modify: entry.modify,
    sessionLabel: args.session_label ?? `chain-${entry.label}`,
  })
  const changed = args.auto_compare
    ? result.status !== baseline.status || isResponseBodyChanged(ctx, result.exchange_id, baseline.exchange_id)
    : false
  return { label: entry.label, result, changed_behavior: changed }
}

function isResponseBodyChanged(ctx: ProbeLabContext, replayId: number, baselineId: number): boolean {
  const replay = ctx.store.getExchange(replayId)
  const baseline = ctx.store.getExchange(baselineId)
  if (!replay || !baseline) return false
  return toText(replay.response_body) !== toText(baseline.response_body)
}

function toText(value: Buffer | string | null): string | null {
  if (value == null) return null
  return typeof value === "string" ? value : value.toString("utf8")
}
