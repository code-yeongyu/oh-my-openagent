import { canonicalAgentName, legacyAgentNameNotice } from "@oh-my-opencode/senpi-task"

// Advisory lint for dag definitions, surfacing the mass-ulw planning doctrine at the tool
// boundary. Warnings never reject: the dag tool is generic, so a definition that ignores the
// node prompt contract still runs - the model sees the warning in the start result and can
// cancel, fix the definition, and re-start under a new key.

export type DagLintNode = {
  readonly id: string
  readonly prompt: string
  readonly subagent_type?: string
}

const TASK_MARKER = /TASK:/
const STOP_MARKER = /STOP WHEN/
const VERIFICATION_SHAPE = /\b(verify|verification|verifier|audit|validate|validation|qa)\b/i

export function lintDagDefinitionNodes(nodes: readonly DagLintNode[]): readonly string[] {
  const warnings: string[] = []
  for (const node of nodes) {
    if (!TASK_MARKER.test(node.prompt)) {
      warnings.push(
        `node "${node.id}": prompt is missing the TASK: marker from the mass-ulw node prompt contract (TASK/DELIVERABLE/SCOPE/VERIFY/STOP WHEN)`,
      )
    }
    if (!STOP_MARKER.test(node.prompt)) {
      warnings.push(`node "${node.id}": prompt is missing a STOP WHEN condition from the mass-ulw node prompt contract`)
    }
    if (node.subagent_type !== undefined) {
      // Retired curated ids still spawn through the canonical route (dag/graph.ts canonicalizes the
      // route); the lint surfaces the deprecation so the definition can be fixed before removal.
      const canonical = canonicalAgentName(node.subagent_type)
      if (canonical.legacy !== undefined) {
        warnings.push(`node "${node.id}": ${legacyAgentNameNotice(canonical.legacy, canonical.name)}`)
      }
    }
  }
  if (nodes.length >= 2 && !nodes.some((node) => VERIFICATION_SHAPE.test(node.id) || VERIFICATION_SHAPE.test(node.prompt))) {
    warnings.push(
      `run has ${nodes.length} nodes but no verification node; a graph that produces work ends with a verification wave (mass-ulw planning reference)`,
    )
  }
  return warnings
}
