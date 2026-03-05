import type { DelegateTaskArgs } from "./types"
import type { TaskAgentCatalog, AgentMatch } from "./agent-catalog"
import { matchAgentByName, matchPrimaryAgentByName } from "./agent-catalog"

export type TaskTarget =
  | { kind: "continuation" }
  | { kind: "category"; name: string; correctedFrom?: "subagent_type" }
  | { kind: "agent"; name: string }
  | { kind: "error"; code: string; message: string }

interface AvailableCategory {
  name: string
  description?: string
  model?: string
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase()
}

function findCategory(
  name: string,
  availableCategories: AvailableCategory[]
): AvailableCategory | null {
  const normalized = normalizeName(name)
  const matched = availableCategories.find(
    (cat) => normalizeName(cat.name) === normalized
  )
  return matched || null
}

/**
 * Resolves the task target from args into a discriminated union.
 * Pure function - no side effects, no client calls.
 *
 * Priority order:
 * 1. session_id present → continuation
 * 2. explicit category → category (canonical name)
 * 3. missing/empty target → error
 * 4. agent match from catalog (if catalog available) → agent (canonical name)
 * 5. category match from availableCategories (if catalog available) → category (corrected)
 * 6. catalog unavailable → pass through as agent (fail open)
 * 7. error
 */
export function resolveTaskTarget(
  args: DelegateTaskArgs,
  availableCategories: AvailableCategory[],
  agentCatalog: TaskAgentCatalog | null
): TaskTarget {
  // Priority 1: Continuation session
  if (args.session_id?.trim()) {
    return { kind: "continuation" }
  }

  // Priority 2: Explicit category
  if (args.category?.trim()) {
    const matchedCategory = findCategory(args.category, availableCategories)
    if (matchedCategory) {
      return { kind: "category", name: matchedCategory.name }
    }
    // Invalid category - let downstream handle the error
    return { kind: "category", name: args.category.trim() }
  }

  // Priority 3: Missing target check
  const subagentType = args.subagent_type?.trim()
  if (!subagentType) {
    return {
      kind: "error",
      code: "missing_target",
      message:
        "Invalid arguments: Must provide either category or subagent_type.",
    }
  }

  // Priority 4-6: Resolve based on catalog availability
  if (agentCatalog) {
    // Priority 4: Agent match (agent names win over category names)
    const agentMatch: AgentMatch | null = matchAgentByName(
      subagentType,
      agentCatalog
    )
    if (agentMatch) {
      return { kind: "agent", name: agentMatch.canonicalName }
    }

    // Priority 4b: Primary agent check (better error than "unknown")
    const primaryMatch = matchPrimaryAgentByName(subagentType, agentCatalog)
    if (primaryMatch) {
      return {
        kind: "error",
        code: "primary_agent",
        message: `Cannot call primary agent "${primaryMatch.canonicalName}" via task. Primary agents are top-level orchestrators.`,
      }
    }

    // Priority 5: Category match (correction from subagent_type)
    const categoryMatch = findCategory(subagentType, availableCategories)
    if (categoryMatch) {
      return {
        kind: "category",
        name: categoryMatch.name,
        correctedFrom: "subagent_type",
      }
    }

    // Priority 6a: No match found with usable catalog - error
    const availableAgents = agentCatalog.callable
      .map((a) => a.name)
      .sort()
      .join(", ")
    return {
      kind: "error",
      code: "unknown_agent",
      message: `Unknown agent: "${subagentType}". Available agents: ${availableAgents}`,
    }
  }

  // Priority 6b: Catalog unavailable - fail open, pass through as agent
  // This preserves backward compatibility when catalog fetch fails
  return { kind: "agent", name: subagentType }
}
