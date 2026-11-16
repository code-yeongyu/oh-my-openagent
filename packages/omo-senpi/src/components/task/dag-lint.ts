// Advisory lint for dag definitions, surfacing the mass-ulw node prompt contract at the tool
// boundary. Warnings never reject: the dag tool is generic, so a definition that ignores the
// contract still runs - the model sees the warning in the start result and can cancel, fix the
// definition, and re-start under a new key. The lint judges each prompt, never the graph's shape:
// whether a run carries a verification node is the orchestrator's call, since it may run the
// final check itself.

export type DagLintNode = {
  readonly id: string
  readonly prompt: string
  readonly subagent_type?: string
}

const TASK_MARKER = /TASK:/
const STOP_MARKER = /STOP WHEN/

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
  return warnings
}
