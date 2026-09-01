/**
 * Bash-permission feasibility spike, 2026-06-15:
 * OpenCode exposes Bash permission enforcement to plugin tools through
 * ToolContext.ask({ permission: "bash", patterns: [command], ... }). The
 * plugin and SDK surfaces do not expose a pure dry-run evaluator that returns
 * the exact Bash decision for an arbitrary command string: tool.execute.before
 * hooks only see the active tool call and mutable args, permission.ask is a
 * hook for an already-created permission request, and the SDK can only reply to
 * existing permission requests. Therefore this gate uses an injected
 * bashPermissionAsk callback when a caller has ToolContext.ask available; if
 * that callback is absent, it fails closed to monitor.allowed_commands.
 */

import type { MonitorConfig as SchemaMonitorConfig } from "../../config/schema/monitor"
import { tokenizeCommand } from "../../tools/interactive-bash/tools"

export type MonitorConfig = Pick<SchemaMonitorConfig, "enabled" | "allowed_commands"> & Partial<SchemaMonitorConfig>

export type MonitorPermissionVia = "bash-equivalent" | "allowlist" | "feature-disabled"

export type MonitorPermissionResult = {
  allowed: boolean
  reason: string
  via: MonitorPermissionVia
}

export type BashPermissionAskInput = {
  permission: "bash"
  patterns: string[]
  always: string[]
  metadata: {
    command: string
  }
}

export type MonitorPermissionContext = {
  config: MonitorConfig
  bashPermissionAsk?: (input: BashPermissionAskInput) => Promise<void>
}

function getErrorReason(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }

  if (typeof error === "string" && error) {
    return error
  }

  return "bash permission denied"
}

function getProgram(command: string): string | undefined {
  return tokenizeCommand(command)[0]
}

async function checkBashEquivalentPermission(
  command: string,
  bashPermissionAsk: (input: BashPermissionAskInput) => Promise<void>,
): Promise<MonitorPermissionResult> {
  try {
    await bashPermissionAsk({
      permission: "bash",
      patterns: [command],
      always: [command],
      metadata: { command },
    })
  } catch (error) {
    return {
      allowed: false,
      reason: getErrorReason(error),
      via: "bash-equivalent",
    }
  }

  return {
    allowed: true,
    reason: "command allowed by bash permission",
    via: "bash-equivalent",
  }
}

function checkAllowlistPermission(command: string, config: MonitorConfig): MonitorPermissionResult {
  const program = getProgram(command)
  const allowedCommands = config.allowed_commands ?? []

  if (program && allowedCommands.includes(program)) {
    return {
      allowed: true,
      reason: "command allowed by allowed_commands",
      via: "allowlist",
    }
  }

  return {
    allowed: false,
    reason: "command not in allowed_commands",
    via: "allowlist",
  }
}

export async function checkMonitorCommandPermission(
  command: string,
  ctx: MonitorPermissionContext,
): Promise<MonitorPermissionResult> {
  if (ctx.config.enabled === false) {
    return {
      allowed: false,
      reason: "monitor feature disabled",
      via: "feature-disabled",
    }
  }

  if (ctx.bashPermissionAsk) {
    return checkBashEquivalentPermission(command, ctx.bashPermissionAsk)
  }

  return checkAllowlistPermission(command, ctx.config)
}
