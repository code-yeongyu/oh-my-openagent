import type { ToolDefinition } from "@code-yeongyu/senpi"

import type { OmoSenpiComponent } from "../../extension/types"
import { detectSelfTerminatingCommand, type SelfKillDetection } from "./detect"

const GUARDED_TOOL_NAMES = new Set(["bash", "bash_input", "monitor"])

export const SELF_KILL_GUARD_NOTICE_CUSTOM_TYPE = "omo-self-kill-guard:notice"

function extractCommand(toolName: string, params: unknown): string {
  const record = typeof params === "object" && params !== null ? (params as Record<string, unknown>) : {}
  if (toolName === "bash_input") {
    const input = record.input
    return typeof input === "string" ? input : ""
  }
  const command = record.command
  return typeof command === "string" ? command : ""
}

export const SAFE_ALTERNATIVE = "Use kill_bash({ bash_id }), or taskkill /PID <pid> /F on the port owner only."

function buildNoticeText(toolName: string, detection: SelfKillDetection): string {
  return `[omo-self-kill-guard] ${detection.reason} Refused ${toolName}. ${SAFE_ALTERNATIVE}`
}

export function buildBlockMessage(toolName: string, detection: SelfKillDetection): string {
  return buildNoticeText(toolName, detection)
}

function guardExecute(toolName: string, execute: ToolDefinition["execute"]): ToolDefinition["execute"] {
  return async function guardedExecute(this: unknown, toolCallId, params, signal, onUpdate, execCtx) {
    const command = extractCommand(toolName, params)
    const detection = detectSelfTerminatingCommand(command)
    if (detection !== undefined) {
      throw new Error(buildNoticeText(toolName, detection))
    }
    return execute.call(this, toolCallId, params, signal, onUpdate, execCtx)
  }
}

interface ToolExecutionStartPayload {
  toolName?: string
  args?: Record<string, unknown>
}

function isGuardedToolName(name: unknown): name is string {
  return typeof name === "string" && GUARDED_TOOL_NAMES.has(name)
}

/**
 * Refuse shell commands that would terminate the senpi host process.
 *
 * Plugins load before builtin extensions, so the `registerTool` wrapper below
 * intercepts the core bash/bash_input/monitor tools at their registration time
 * and wraps their execute closures. A `tool_execution_start` observer remains
 * as a fallback notice in case a future load-order change skips the wrapper.
 */
export function createSelfKillGuardComponent(): OmoSenpiComponent {
  return {
    name: "self-kill-guard",
    register(pi) {
      const wrapped = new Set<unknown>()
      const originalRegisterTool = pi.registerTool.bind(pi)
      pi.registerTool = (tool: Record<string, unknown>): void => {
        const name = Reflect.get(tool, "name")
        const execute = Reflect.get(tool, "execute")
        if (isGuardedToolName(name) && typeof execute === "function" && !wrapped.has(tool)) {
          wrapped.add(tool)
          Reflect.set(tool, "execute", guardExecute(name, execute as ToolDefinition["execute"]))
        }
        originalRegisterTool(tool)
      }

      pi.on("tool_execution_start", (payload: unknown) => {
        const event = (payload ?? {}) as ToolExecutionStartPayload
        if (!isGuardedToolName(event.toolName)) return
        const command = extractCommand(event.toolName, event.args ?? {})
        const detection = detectSelfTerminatingCommand(command)
        if (detection === undefined) return
        void pi.sendMessage(
          {
            customType: SELF_KILL_GUARD_NOTICE_CUSTOM_TYPE,
            content: buildNoticeText(event.toolName, detection),
            display: true,
            details: detection,
          },
          { triggerTurn: false, deliverAs: "steer" },
        )
      })
    },
  }
}
