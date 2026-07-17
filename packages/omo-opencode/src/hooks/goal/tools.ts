import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import type { GoalController } from "./controller"
import { GoalToolResponseSchema } from "./types"

export type GoalToolsDeps = {
  readonly controller: GoalController
  readonly getSessionID: () => string | undefined
}

function formatResponse(goal: ReturnType<GoalController["getGoal"]>): string {
  return JSON.stringify(GoalToolResponseSchema.parse({ goal }), null, 2)
}

export function createGoalTool(deps: GoalToolsDeps): ToolDefinition {
  return tool({
    description: `Create or replace the active goal for the current session.

Use this when the user asks you to set a goal, or when you decide a new high-level objective is needed. The goal persists across turns and is shown in the TUI.

The objective should be concise (under 2000 characters) and describe the desired outcome, not a single action.`,
    args: {
      objective: tool.schema.string().describe("Concise outcome the session should achieve"),
      session_id: tool.schema.string().optional().describe("Session ID to target (default: current session)"),
    },
    execute: async (args, _context) => {
      const sessionID = args.session_id ?? deps.getSessionID()
      if (sessionID === undefined) {
        return "Error: no session_id available"
      }
      const goal = deps.controller.setGoal(sessionID, args.objective)
      return formatResponse(goal)
    },
  })
}

export function updateGoalTool(deps: GoalToolsDeps): ToolDefinition {
  return tool({
    description: `Update the active goal for the current session.

Use this to pause, resume, complete, or change the objective of the current goal. When you believe the goal has been achieved, call update_goal with status: "complete".`,
    args: {
      status: tool.schema.enum(["active", "paused", "complete"]).optional().describe("New goal status"),
      objective: tool.schema.string().optional().describe("New objective text"),
      session_id: tool.schema.string().optional().describe("Session ID to target (default: current session)"),
    },
    execute: async (args, _context) => {
      const sessionID = args.session_id ?? deps.getSessionID()
      if (sessionID === undefined) {
        return "Error: no session_id available"
      }
      if (args.objective !== undefined) {
        deps.controller.setGoal(sessionID, args.objective)
      }
      if (args.status === "paused") {
        deps.controller.pauseGoal(sessionID)
      } else if (args.status === "active") {
        deps.controller.resumeGoal(sessionID)
      } else if (args.status === "complete") {
        deps.controller.markComplete(sessionID)
      }
      return formatResponse(deps.controller.getGoal(sessionID))
    },
  })
}

export function getGoalTool(deps: GoalToolsDeps): ToolDefinition {
  return tool({
    description: `Read the active goal for the current session.

Returns the current objective, status, and usage accounting. Returns null if no goal is active.`,
    args: {
      session_id: tool.schema.string().optional().describe("Session ID to target (default: current session)"),
    },
    execute: async (args, _context) => {
      const sessionID = args.session_id ?? deps.getSessionID()
      if (sessionID === undefined) {
        return "Error: no session_id available"
      }
      return formatResponse(deps.controller.getGoal(sessionID))
    },
  })
}

export function createGoalTools(deps: GoalToolsDeps): Record<string, ToolDefinition> {
  return {
    create_goal: createGoalTool(deps),
    update_goal: updateGoalTool(deps),
    get_goal: getGoalTool(deps),
  }
}
