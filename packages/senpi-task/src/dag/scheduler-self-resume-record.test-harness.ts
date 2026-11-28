// The run record the self-resumed node child cases (#12134) start from: a compiled definition of
// category nodes owned by one parent session.
import { compileDag, type DagDefinition } from "./graph"
import type { DagRunRecordV1 } from "./manager"
import type { DagRunId } from "./types"

export const runId = "run-self-resume" as DagRunId
export const parentSessionId = "ses-parent"

export function node(id: string, dependsOn: readonly string[] = []): DagDefinition["nodes"][number] {
  return { id, prompt: `do ${id}`, category: "quick", ...(dependsOn.length === 0 ? {} : { dependsOn }) }
}

export function recordFor(nodes: DagDefinition["nodes"]): DagRunRecordV1 {
  const createdAt = "2026-11-26T00:00:00.000Z"
  const input: DagDefinition = { key: "self-resume", name: "self resume", nodes }
  const compiled = compileDag(input, { at: createdAt })
  if (!compiled.ok) throw new Error("test DAG did not compile")
  return {
    schemaVersion: 1,
    checkpointSeq: 0,
    runId,
    runKey: input.key,
    name: input.name,
    parentSessionId,
    rootSessionId: "ses-root",
    definitionFingerprint: "definition-fingerprint",
    definition: {
      key: input.key,
      name: input.name,
      nodes: nodes.map((entry) => ({ ...entry, effectivePrompt: entry.prompt })),
    },
    status: "pending",
    generation: 1,
    createdAt,
    updatedAt: createdAt,
    nodes: compiled.nodes,
    edges: compiled.edges,
    waves: compiled.waves,
    criticalPath: compiled.criticalPath,
    bottlenecks: compiled.bottlenecks,
    diagnostics: compiled.diagnostics,
  }
}
