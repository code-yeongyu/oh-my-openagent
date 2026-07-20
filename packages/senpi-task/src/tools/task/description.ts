import type { OmoConfig } from "@oh-my-opencode/omo-config-core"

import type { AgentDefinition } from "../../agents"
import { listTaskAgents, listTaskCategories } from "./categories"
import type { TaskAgentInfo, TaskCategoryInfo } from "./types"

export const TASK_PROMPT_SNIPPET = "Delegate foreground or background work to a child agent (category XOR subagent_type)."

export const TASK_PROMPT_GUIDELINES: readonly string[] = [
  "Provide EITHER category OR subagent_type - never both, never neither.",
  "Use run_in_background=true only for parallel independent work; the default waits and returns the result.",
  "Continue an existing child with task_send(to=\"st_...\", message=\"...\"); task always spawns.",
  "Read progress with task_output, steer with task_send, and cancel with task_cancel.",
]

type DescriptionInput = {
  readonly omoConfig: OmoConfig
  readonly agents: Readonly<Record<string, AgentDefinition>>
}

function renderList(entries: readonly (TaskCategoryInfo | TaskAgentInfo)[]): string {
  if (entries.length === 0) return "  (none configured)"
  return entries.map((entry) => (entry.description ? `  - ${entry.name}: ${entry.description}` : `  - ${entry.name}`)).join("\n")
}

export function buildTaskToolDescription(input: DescriptionInput): string {
  const categories = listTaskCategories(input.omoConfig)
  const agents = listTaskAgents(input.agents)
  const agentNames = agents.map((agent) => agent.name).join(", ") || "none loaded"
  return `Spawn a child task with category-based or direct agent selection.

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
  - model / name: optional overrides.

  WHEN TO CONTINUE:
  - A task needs a follow-up -> task_send(to="st_...", message="Also: [question]")
  - A task was parked/interrupted -> task_send(to="st_...", message="Continue with: [specific issue]")

  Prompts MUST be in English.`
}
