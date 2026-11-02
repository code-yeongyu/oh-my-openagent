import type { DagNodeInput } from "./graph"
import type { DagNode, DagSnapshotNode } from "./types"

export function withDefinitionFields(
  nodes: readonly DagNode[],
  definitionNodes: readonly DagNodeInput[],
): readonly DagSnapshotNode[] {
  const inputs = new Map(definitionNodes.map((input) => [input.id, input] as const))
  return nodes.map((node) => {
    const input = inputs.get(node.id)
    if (input === undefined) return node
    return {
      ...node,
      ...(input.task_summary === undefined ? {} : { task_summary: input.task_summary }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.load_skills === undefined ? {} : { load_skills: input.load_skills }),
    }
  })
}
