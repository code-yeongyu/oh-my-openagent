// Advisory lint for dag definitions, surfacing the mass-ulw planning doctrine at the tool
// boundary. Warnings never reject: the dag tool is generic, so a definition that ignores the
// node prompt contract still runs - the model sees the warning in the start result and can
// cancel, fix the definition, and re-start under a new key.

export type DagLintNode = {
  readonly id: string
  readonly prompt: string
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
  }
  if (nodes.length >= 2 && !nodes.some((node) => VERIFICATION_SHAPE.test(node.id) || VERIFICATION_SHAPE.test(node.prompt))) {
    warnings.push(
      `run has ${nodes.length} nodes but no verification node; a graph that produces work ends with a verification wave (mass-ulw planning reference)`,
    )
  }
  return warnings
}
