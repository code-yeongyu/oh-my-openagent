import { tool, type ToolDefinition } from "@opencode-ai/plugin"

import type { OhMyOpenCodeConfig } from "../../config/schema/oh-my-opencode-config"
import { checkMonitorCommandPermission, type BashPermissionAskInput } from "../../features/monitor/permission"
import { createMonitorFilter } from "../../features/monitor/filter"
import type { MonitorManager, MonitorMode, MonitorStartArgs } from "../../features/monitor/types"
import type { PluginContext } from "../../plugin/types"

type MonitorToolContext = {
  sessionID: string
  messageID: string
  agent: string
  abort: AbortSignal
  ask?: (input: BashPermissionAskInput) => Promise<void>
}

type MonitorStartConfig = {
  monitor?: Partial<NonNullable<OhMyOpenCodeConfig["monitor"]>>
}

const DEFAULT_MONITOR_CONFIG = {
  enabled: false,
  live_mode_enabled: false,
  max_monitors_per_session: 3,
  max_runtime_ms: 1800000,
  batch_max_lines: 50,
  batch_max_bytes: 16384,
  flush_interval_ms: 1000,
  ring_max_lines: 1000,
  line_max_bytes: 8192,
  pattern_max_length: 512,
}

function getMonitorConfig(pluginConfig: MonitorStartConfig) {
  return {
    ...DEFAULT_MONITOR_CONFIG,
    ...pluginConfig.monitor,
  }
}

function getEffectiveMode(requestedMode: MonitorMode | undefined, liveModeEnabled: boolean): {
  mode: MonitorMode
  note?: string
} {
  if (requestedMode === "live_safe" && !liveModeEnabled) {
    return {
      mode: "idle",
      note: 'requested mode "live_safe" was coerced to "idle" because monitor.live_mode_enabled is false',
    }
  }

  return { mode: requestedMode ?? "idle" }
}

function formatStartResult(input: {
  monitorId: string
  label: string
  mode: MonitorMode
  maxMonitorsPerSession: number
  maxRuntimeMs: number
  note?: string
}): string {
  const note = input.note ? `\nnote: ${input.note}` : ""

  return `Monitor started successfully.

monitor_id: ${input.monitorId}
label: ${input.label}
mode: ${input.mode}
caps: max_monitors_per_session=${input.maxMonitorsPerSession}, max_runtime_ms=${input.maxRuntimeMs}${note}

To stop this monitor, call monitor_stop with monitor_id="${input.monitorId}".

output arrives automatically — do not poll`
}

export function createMonitorStart(
  manager: MonitorManager,
  pluginConfig: MonitorStartConfig,
  _ctx?: PluginContext,
): ToolDefinition {
  return tool({
    description:
      "Start a non-interactive background monitor command. Output is delivered automatically to the parent session; use labels instead of raw commands in transcripts.",
    args: {
      command: tool.schema.string().describe("Shell command to run in the background monitor"),
      label: tool.schema.string().optional().describe("Safe human-facing label for the monitor"),
      mode: tool.schema
        .union([tool.schema.literal("idle"), tool.schema.literal("live_safe")])
        .optional()
        .describe("Delivery mode. idle is safe default; live_safe requires monitor.live_mode_enabled."),
      match_pattern: tool.schema
        .string()
        .optional()
        .describe("Optional JavaScript regex. Matching lines are delivered automatically."),
    },
    async execute(args: MonitorStartArgs, toolContext) {
      const ctx = toolContext as MonitorToolContext
      const monitorConfig = getMonitorConfig(pluginConfig)

      const permission = await checkMonitorCommandPermission(args.command, {
        config: monitorConfig,
        ...(ctx.ask ? { bashPermissionAsk: ctx.ask } : {}),
      })

      if (!permission.allowed) {
        return `[ERROR] monitor_start denied: ${permission.reason}`
      }

      const filterResult = createMonitorFilter(args.match_pattern, {
        patternMaxLength: monitorConfig.pattern_max_length,
      })

      if (!filterResult.filter) {
        return `[ERROR] monitor_start match_pattern rejected: ${filterResult.error ?? "invalid pattern"}`
      }

      const effectiveMode = getEffectiveMode(args.mode, monitorConfig.live_mode_enabled)

      try {
        const record = await manager.start({
          command: args.command,
          label: args.label,
          mode: effectiveMode.mode,
          matchPattern: args.match_pattern,
          parentSessionId: ctx.sessionID,
          parentMessageId: ctx.messageID,
        })

        return formatStartResult({
          monitorId: record.id,
          label: record.label,
          mode: effectiveMode.mode,
          maxMonitorsPerSession: monitorConfig.max_monitors_per_session,
          maxRuntimeMs: monitorConfig.max_runtime_ms,
          note: effectiveMode.note,
        })
      } catch {
        return `[ERROR] monitor_start failed for label: ${args.label ?? "(manager-assigned label)"}`
      }
    },
  })
}
