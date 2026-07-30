import type { OmoConfig } from "@oh-my-opencode/omo-config-core"

import type { AgentDefinition } from "../../agents"
import { listTaskAgents, listTaskCategories } from "./categories"
import type { TaskAgentInfo, TaskCategoryInfo } from "./types"

export const TASK_PROMPT_SNIPPET = "Spawn one child or fan out a batch; use task_send to continue an existing child."

export const TASK_PROMPT_GUIDELINES: readonly string[] = [
  "Use run_in_background=true only for parallel independent work; the default waits and returns the result.",
  "Continue an existing child with task_send(to=\"st_...\", message=\"...\"); task always spawns.",
  "Use task_output for one midpoint status or transcript peek; use task_cancel to end a child.",
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
  return `Spawn one child task or fan out a batch.

Choose exactly one input form:
- Single: prompt
- Batch: tasks (1-16 items); top-level target, model, and skills are inherited when an item omits them.

Each spawn MUST provide EITHER category OR subagent_type after inheritance. DO NOT provide both.

- category routes through Sisyphus-Junior. Available categories:
${renderList(categories)}
- subagent_type invokes a loaded agent directly. Available agents: ${agentNames}

Blank provider padding is normalized automatically; do not add filler values.
load_skills prepends named skills. run_in_background=true returns task ids for parallel work; false waits for results.
model and name are optional overrides. task_send continues an existing child; task always spawns.
Prompts MUST be in English.`
}
