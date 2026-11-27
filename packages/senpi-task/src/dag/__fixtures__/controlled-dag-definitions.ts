// Node definitions, run identities and the scripted child planner shared by the DAG end-to-end suites.
import type { ChildPlanner } from "../../manager/types"
import type { DagDefinition, DagNodeInput } from "../graph"

export const parentSessionId = "session-e2e-failure-parent"
export const rootSessionId = "session-e2e-failure-root"

export function categoryNode(
  id: string,
  dependsOn: readonly string[] = [],
  overrides: {
    readonly prompt?: string
    readonly label?: string
    readonly task_summary?: string
    readonly description?: string
    readonly load_skills?: readonly string[]
  } = {},
): DagNodeInput {
  return {
    id,
    prompt: `do ${id}`,
    category: "quick",
    ...(dependsOn.length === 0 ? {} : { dependsOn }),
    ...overrides,
  }
}

export function definition(key: string, nodes: readonly DagNodeInput[]): DagDefinition {
  return { key, name: key.replaceAll("-", " "), nodes }
}

export function planner(spec: Parameters<ChildPlanner>[0]): ReturnType<ChildPlanner> {
  const target = spec.category ?? spec.subagent_type ?? "default"
  return {
    kind: "resolved",
    plan: {
      model: spec.model ?? `scripted/${target}`,
      ...(spec.category === undefined ? {} : { category: spec.category }),
      ...(spec.subagent_type === undefined ? {} : { agentType: spec.subagent_type }),
    },
  }
}
