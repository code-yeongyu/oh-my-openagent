import { TASK_TOOL_NAME } from "@oh-my-opencode/senpi-task"

import type { ComponentLogger, SenpiExtensionAPI } from "../../extension/types"

const CHILD_CONTROLS = new Set(["task_send", "task_output", "task_cancel"])
const EVENT = "task_control_activation_failed"

export function wireTaskControlExposure(pi: SenpiExtensionAPI, logger: ComponentLogger): void {
  let lastFailure: string | undefined
  pi.on("session_start", () => { lastFailure = undefined })
  pi.on("tool_call", (event) => {
    if (typeof event !== "object" || event === null || !("toolName" in event) || event.toolName !== TASK_TOOL_NAME)
      return

    let missing: string[] = []
    let reason: string | undefined
    try {
      if (pi.getAllTools === undefined || pi.getActiveTools === undefined || pi.setActiveTools === undefined) {
        reason = "host_api_unavailable"
      } else {
        const active = pi.getActiveTools()
        // Only promote what Senpi would allow a by-name lazy activation to expose. The
        // live registry omits tools excluded by the session's allowlist/denylist.
        missing = pi.getAllTools()
          .filter((tool) => CHILD_CONTROLS.has(tool.name) && tool.exposure === "search" &&
            tool.allowLazyActivation !== false && tool.evalOnly !== true && !active.includes(tool.name))
          .map((tool) => tool.name)
        if (missing.length > 0) {
          pi.setActiveTools([...active, ...missing])
          const nowActive = pi.getActiveTools()
          missing = missing.filter((name) => !nowActive.includes(name))
          if (missing.length > 0) reason = "activation_rejected"
        }
      }
    } catch {
      // Host errors can contain prompts or paths; log the failed phase, not the raw exception.
      reason = "host_api_error"
    }
    const failure = reason === undefined ? undefined : `${reason}:${missing.join(",")}`
    if (reason !== undefined && failure !== lastFailure)
      logger.warn("omo-senpi could not expose child task controls", { event: EVENT, reason, tools: missing })
    lastFailure = failure
  }, { runs: "brain" })
}
