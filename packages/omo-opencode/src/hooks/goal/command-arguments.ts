import type { GoalStatus } from "./types"

export type ParsedGoalCommand =
  | { readonly kind: "show" }
  | { readonly kind: "clear" }
  | { readonly kind: "setStatus"; readonly status: Extract<GoalStatus, "active" | "paused"> }
  | { readonly kind: "setObjective"; readonly objective: string }

export function parseGoalCommand(rawArgs: string): ParsedGoalCommand {
  const trimmed = rawArgs.trim()

  if (trimmed === "") {
    return { kind: "show" }
  }

  switch (trimmed.toLowerCase()) {
    case "pause":
      return { kind: "setStatus", status: "paused" }
    case "resume":
      return { kind: "setStatus", status: "active" }
    case "clear":
      return { kind: "clear" }
    default:
      return { kind: "setObjective", objective: trimmed }
  }
}
