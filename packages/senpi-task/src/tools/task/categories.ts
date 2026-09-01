import type { OmoCategoryConfig, OmoConfig } from "@oh-my-opencode/omo-config-core"

import type { AgentDefinition } from "../../agents"
import { CATEGORY_DESCRIPTIONS, DEFAULT_CATEGORIES, categoryGateModel } from "../../category"
import type { TaskAgentInfo, TaskCategoryInfo } from "./types"

function ownValue<TValue>(record: Readonly<Record<string, TValue>>, key: string): TValue | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined
}

// Dynamic category surface for the tool description: builtin categories merged with omo.json ones,
// disabled categories dropped, user descriptions winning over the builtin default text.
export function listTaskCategories(config: OmoConfig): readonly TaskCategoryInfo[] {
  const userCategories: Readonly<Record<string, OmoCategoryConfig>> = config.categories ?? {}
  const names = Array.from(new Set([...Object.keys(DEFAULT_CATEGORIES), ...Object.keys(userCategories)])).sort()
  const entries: TaskCategoryInfo[] = []
  for (const name of names) {
    const userConfig = ownValue(userCategories, name)
    if (userConfig?.disable === true) continue
    const description = userConfig?.description ?? ownValue(CATEGORY_DESCRIPTIONS, name)
    const annotated = userConfig === undefined ? withGateAnnotation(name, description) : description
    entries.push(annotated !== undefined ? { name, description: annotated } : { name })
  }
  return entries
}

// A builtin-only gated category stays listed with its required model, because the live registry is
// not available when the task tool description is built; the spawn-time resolver owns the real gate.
function withGateAnnotation(name: string, description: string | undefined): string | undefined {
  const gateModel = categoryGateModel(name)
  if (gateModel === undefined) return description
  const annotation = `(requires ${gateModel})`
  return description === undefined ? annotation : `${description} ${annotation}`
}

// Agent types surfaced from the todo-5 loader; disabled definitions are hidden.
export function listTaskAgents(agents: Readonly<Record<string, AgentDefinition>>): readonly TaskAgentInfo[] {
  return Object.keys(agents)
    .sort()
    .map((name) => ownValue(agents, name))
    .filter((agent): agent is AgentDefinition => agent !== undefined && agent.disable !== true)
    .map((agent) => (agent.description !== undefined ? { name: agent.name, description: agent.description } : { name: agent.name }))
}
