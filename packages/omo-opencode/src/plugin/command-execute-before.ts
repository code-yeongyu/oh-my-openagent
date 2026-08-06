import type { CreatedHooks } from "../create-hooks"
import { parseGoalCommand } from "../hooks/goal/command-arguments"
import { log } from "../shared/logger"
import { stopContinuation } from "./stop-continuation"

type CommandExecuteBeforeInput = {
  command: string
  sessionID: string
  arguments: string
}

type CommandExecuteBeforeOutput = {
  parts: Array<{ type: string; text?: string; [key: string]: unknown }>
}

const NATIVE_GOAL_COMMAND_MARKER = "<omo-native-goal-command>"

export function markNativeGoalCommand(
  parts: CommandExecuteBeforeOutput["parts"],
): void {
  parts.push({
    type: "text",
    text: NATIVE_GOAL_COMMAND_MARKER,
    synthetic: true,
  })
}

export function consumeNativeGoalCommandMarker(
  parts: CommandExecuteBeforeOutput["parts"],
): boolean {
  const markerIndex = parts.findIndex(
    (part) => (
      part.type === "text"
      && part.text === NATIVE_GOAL_COMMAND_MARKER
      && part["synthetic"] === true
    ),
  )
  if (markerIndex === -1) {
    return false
  }
  parts.splice(markerIndex, 1)
  return true
}

function hasPartsOutput(value: unknown): value is CommandExecuteBeforeOutput {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  const parts = record["parts"]
  return Array.isArray(parts)
}

export function createCommandExecuteBeforeHandler(args: {
  directory: string
  hooks: CreatedHooks
}): (
  input: CommandExecuteBeforeInput,
  output: CommandExecuteBeforeOutput,
) => Promise<void> {
  const { directory, hooks } = args

  return async (input, output): Promise<void> => {
    await hooks.autoSlashCommand?.["command.execute.before"]?.(input, output)

    const normalizedCommand = input.command.toLowerCase()
    const sessionID = input.sessionID
    if (normalizedCommand === "stop-continuation" && sessionID) {
      stopContinuation({ directory, hooks, sessionID })
    }

    if (hooks.goal && sessionID && normalizedCommand === "goal") {
      const parsed = parseGoalCommand(input.arguments)
      switch (parsed.kind) {
        case "setObjective":
          hooks.goal.setGoal(sessionID, parsed.objective)
          break
        case "setStatus":
          if (parsed.status === "paused") {
            hooks.goal.pauseGoal(sessionID)
          } else {
            hooks.goal.resumeGoal(sessionID)
          }
          break
        case "clear":
          hooks.goal.clearGoal(sessionID)
          break
        case "show":
          // No side effect.
          break
        default:
          break
      }
      markNativeGoalCommand(output.parts)
    }

    if (
      hooks.startWork
      && normalizedCommand === "start-work"
      && hasPartsOutput(output)
    ) {
      await hooks.startWork["command.execute.before"]?.(input, output)
      if (hooks.stopContinuationGuard?.isStopped(sessionID)) {
        hooks.stopContinuationGuard.clear(sessionID)
        log("[stop-continuation] Stop state cleared by native command", {
          sessionID,
          command: normalizedCommand,
        })
      }
    }
  }
}
