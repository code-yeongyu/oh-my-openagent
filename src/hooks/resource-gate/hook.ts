import type { PluginInput } from "@opencode-ai/plugin"

import { log } from "../../shared"
import {
  CRITICAL_THRESHOLD_GB,
  HOOK_NAME,
  WARNING_PERCENT,
  WARNING_THRESHOLD_GB,
} from "./constants"
import { checkMacOSMemory } from "./memory-check"

export function createResourceGateHook(ctx: PluginInput) {
  void ctx

  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown> },
    ): Promise<void> => {
      if (input.tool !== "task") {
        return
      }

      const args = output.args
      if (args.run_in_background !== true) {
        return
      }

      const memory = checkMacOSMemory()

      if (memory.availableGB < CRITICAL_THRESHOLD_GB) {
        log(`[${HOOK_NAME}] BLOCKED: ${memory.availableGB.toFixed(1)}GB available`, {
          sessionID: input.sessionID,
          ...memory,
        })

        throw new Error(
          `[Resource Gate] Cannot spawn background agent: only ${memory.availableGB.toFixed(1)}GB memory available (need >${CRITICAL_THRESHOLD_GB}GB). ` +
            `System is at ${memory.usedPercent.toFixed(0)}% memory usage. ` +
            "Use run_in_background=false to run synchronously instead.",
        )
      }

      if (memory.availableGB < WARNING_THRESHOLD_GB || memory.usedPercent > WARNING_PERCENT) {
        const warningTag =
          ` [MEMORY WARNING: ${memory.availableGB.toFixed(1)}GB free, ${memory.usedPercent.toFixed(0)}% used - ` +
          `serialize instead of parallel spawns, recommendation: ${memory.recommendation}]`

        if (typeof args.description === "string") {
          args.description = args.description + warningTag
        } else {
          args.description = warningTag.trim()
        }

        log(`[${HOOK_NAME}] WARNING injected: ${memory.availableGB.toFixed(1)}GB available`, {
          sessionID: input.sessionID,
          ...memory,
        })
      }
    },
  }
}
