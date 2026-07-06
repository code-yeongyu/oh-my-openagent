import type { OmoConfig } from "@oh-my-opencode/omo-config-core"

import type { AgentDefinition } from "../../agents"
import { listTaskAgents, listTaskCategories } from "./categories"
import type { TaskAgentInfo, TaskCategoryInfo } from "./types"

export const TASK_PROMPT_SNIPPET = "Delegate foreground or background work to a child agent (category XOR subagent_type)."

export const TASK_PROMPT_GUIDELINES: readonly string[] = [
  "Provide EITHER category OR subagent_type - never both, never neither.",
  "Use run_in_background=true only for parallel independent work; the default waits and returns the result.",
  "Continue a prior task with task_id (an st_ id) to preserve its full context instead of spawning a new one.",
  "Read progress or steer a running task with task_output / task_send; cancel it with task_cancel.",
]

type DescriptionInput = {
  readonly omoConfig: OmoConfig
  readonly agents: Readonly<Record<string, AgentDefinition>>
}

function renderList(entries: readonly (TaskCategoryInfo | TaskAgentInfo)[]): string {
  if (entries.length === 0) return "  (none configured)"
  return entries.map((entry) => (entry.description ? `  - ${entry.name}: ${entry.description}` : `  - ${entry.name}`)).join("\n")
}

// Ports the omo delegate-task tool-description structure (tool-description.ts:39-79) adapted for
// senpi: categories injected dynamically from omo.json, agents from the loader, and the single-id
// continuation note (one st_ id serves both background handle and continuation, unlike OpenCode's
// bg_/ses_ split).
export function buildTaskToolDescription(input: DescriptionInput): string {
  const categories = listTaskCategories(input.omoConfig)
  const agents = listTaskAgents(input.agents)
  const agentNames = agents.map((agent) => agent.name).join(", ") || "none loaded"
  return `Spawn a child task with category-based or direct agent selection, or continue an existing task.

  CRITICAL: You MUST provide EITHER category OR subagent_type. Omitting BOTH will FAIL. Providing BOTH will FAIL.

  CORRECT - using a category:
    task(category="quick", description="Fix type error", prompt="...")
  CORRECT - direct agent with background parallelism:
    task(subagent_type="oracle", description="Review design", prompt="...", run_in_background=true)

  REQUIRED: provide exactly ONE of:
  - category: routes through Sisyphus-Junior with the category-optimized model. Available categories:
${renderList(categories)}
  - subagent_type: invoke a specific agent directly. Available agents: ${agentNames}

  DO NOT provide both.

  - load_skills: optional string[]; defaults to []. Each named skill's SKILL.md is prepended to the child prompt.
  - run_in_background: optional; defaults to false (waits and returns the final response inline). Set true to return a task_id immediately for parallel work; the system notifies you on completion and you inspect it with task_output / task_send.
  - task_id: continuation id. Unlike OpenCode there is ONE st_ id for everything - the same st_ id returned by a background spawn is the id you pass back here to continue that task with FULL CONTEXT PRESERVED.
  - execution_mode / model / name: optional overrides.

  WHEN TO USE task_id:
  - A task failed or was incomplete -> task(task_id="st_...", prompt="fix: [specific issue]")
  - Follow-up on a previous result -> task(task_id="st_...", prompt="Also: [question]")

  Prompts MUST be in English.`
}
