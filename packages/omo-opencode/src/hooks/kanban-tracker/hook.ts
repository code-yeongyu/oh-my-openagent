/**
 * MaTrix kanban-tracker hook — Auto-enregistre les tâches dans le Kanban.
 *
 * Branché sur `tool.execute.before` : à chaque appel de `task` (delegation),
 * crée une entrée Kanban en état "queued". Sur `tool.execute.after`, transition
 * vers "in-progress" puis "done" ou "failed".
 *
 * Pourquoi un hook et pas un import direct :
 *   - L'orchestrateur de Morpheus utilise des centaines de tool calls
 *   - On veut tracker seulement les délégations (task, call_omo_agent)
 *   - Le hook est non-intrusif, fire-and-forget
 *   - Les erreurs Kanban ne cassent jamais l'orchestration
 *
 * Le dashboard Kanban (.matrix/kanban.html) reflète en temps réel.
 */

import { createTask, transitionTask, type KanbanTask } from "../../features/kanban"
import type { KanbanPriority } from "../../features/kanban"

const DELEGATION_TOOLS = ["task", "call_omo_agent"]

type ToolExecuteInput = {
  tool: string
  sessionID: string
  callID: string
}

type ToolExecuteBeforeOutput = {
  args: Record<string, unknown>
  message?: string
}

type ToolExecuteAfterOutput = {
  args?: Record<string, unknown>
  result?: unknown
  error?: string | unknown
  metadata?: Record<string, unknown>
}

const callIdToTaskId = new Map<string, string>()

function detectPriorityFromArgs(args: Record<string, unknown>): KanbanPriority {
  const prompt = String(args.prompt ?? args.description ?? "")
  const lower = prompt.toLowerCase()
  if (lower.includes("critical") || lower.includes("urgent") || lower.includes("asap")) return "critical"
  if (lower.includes("important") || lower.includes("high priority") || lower.includes("bug")) return "high"
  if (lower.includes("minor") || lower.includes("nit") || lower.includes("low")) return "low"
  return "medium"
}

function extractAgentFromArgs(args: Record<string, unknown>, tool: string): string {
  if (tool === "call_omo_agent") {
    return String(args.agent ?? args.subagent_type ?? "unknown")
  }
  const subagentType = String(args.subagent_type ?? "")
  if (subagentType) return subagentType
  const category = String(args.category ?? "")
  if (category) return `category:${category}`
  return "unknown"
}

function extractTitleFromArgs(args: Record<string, unknown>): string {
  const prompt = String(args.prompt ?? args.description ?? "")
  if (!prompt) return "Untitled task"
  return prompt.slice(0, 80).replace(/\s+/g, " ").trim()
}

export type KanbanTrackerHook = {
  "tool.execute.before"?: (
    input: ToolExecuteInput,
    output: ToolExecuteBeforeOutput,
  ) => Promise<void>
  "tool.execute.after"?: (
    input: ToolExecuteInput,
    output: ToolExecuteAfterOutput,
  ) => Promise<void>
}

export function createKanbanTrackerHook(): KanbanTrackerHook {
  return {
    "tool.execute.before": async (input, output) => {
      if (!DELEGATION_TOOLS.includes(input.tool)) return
      try {
        const agent = extractAgentFromArgs(output.args, input.tool)
        const title = extractTitleFromArgs(output.args)
        const priority = detectPriorityFromArgs(output.args)
        const task = createTask({
          title,
          agent,
          priority: priority as "low" | "medium" | "high" | "critical",
          tags: ["auto-tracked", `tool:${input.tool}`],
        })
        callIdToTaskId.set(input.callID, task.id)
      } catch {
        // Silent: never break the main flow
      }
    },

    "tool.execute.after": async (input, output) => {
      const taskId = callIdToTaskId.get(input.callID)
      if (!taskId) return
      callIdToTaskId.delete(input.callID)
      try {
        const error = output.error
          ? typeof output.error === "string"
            ? output.error
            : (output.error as { message?: string })?.message ?? "unknown error"
          : undefined
        if (error) {
          transitionTask(taskId, "failed", { error })
        } else {
          transitionTask(taskId, "done", { message: "completed" })
        }
      } catch {
        // Silent
      }
    },
  }
}
