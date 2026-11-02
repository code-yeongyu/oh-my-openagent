import { baseSpec, makeManager } from "../../manager/__fixtures__/manager-fakes"
import { compileDag, type DagDefinition } from "../graph"
import type { DagRunRecordV1 } from "../manager"
import { createDagFileStore } from "../store"
import type { DagNodeId, DagRunId } from "../types"
import type { DagSchedulerOptions } from "../scheduler"

export async function pausedRun() {
  const h = makeManager()
  const started = await h.manager.start(baseSpec({ cwd: h.project }))
  if (started.kind !== "started") throw new Error("expected a started child")
  h.store.transition(started.task_id, { type: "pause", timestamp: new Date(0).toISOString() })
  const definition: DagDefinition = {
    key: "paused-controls", name: "paused controls",
    nodes: [
      { id: "a", category: "quick", prompt: "a" },
      { id: "b", category: "quick", prompt: "b", dependsOn: ["a"] },
      { id: "c", category: "quick", prompt: "c", dependsOn: ["b"] },
    ],
  }
  const at = new Date(0).toISOString()
  const compiled = compileDag(definition, { at })
  if (!compiled.ok) throw new Error("invalid fixture definition")
  const runId = "paused-controls" as DagRunId
  const store = createDagFileStore({ project_dir: h.project })
  const record: DagRunRecordV1 = {
    schemaVersion: 1, checkpointSeq: 0, runId, runKey: definition.key, name: definition.name,
    parentSessionId: "parent-1", rootSessionId: "parent-1", definitionFingerprint: "fixture",
    definition: { ...definition, nodes: definition.nodes.map(node => ({ ...node, effectivePrompt: node.prompt })) },
    status: "paused", pause: { reason: "user_stop", pauseSeq: 7 }, generation: 1,
    createdAt: at, updatedAt: at,
    nodes: compiled.nodes.map(node => node.id === "a" ? { ...node, state: "completed", output: "keep-a" }
      : node.id === "b" ? { ...node, state: "paused", taskId: started.task_id, attempt: 1 } : { ...node, state: "blocked" }),
    edges: compiled.edges, waves: compiled.waves, criticalPath: compiled.criticalPath,
    bottlenecks: compiled.bottlenecks, diagnostics: compiled.diagnostics,
  }
  store.writeCheckpoint(runId, record)
  const options: DagSchedulerOptions = { store, taskManager: h.manager, initialRecord: record, now: () => 0 }
  const read = () => {
    const current = store.readCheckpoint<DagRunRecordV1>(runId)
    if (current === null) throw new Error("fixture checkpoint disappeared")
    return current
  }
  return { ...h, definition, taskStore: h.store, store, record, options, read, runId, taskId: started.task_id,
    b: "b" as DagNodeId, c: "c" as DagNodeId }
}
