import { afterEach, describe, expect, test } from "bun:test"

import { createTaskManager } from "../manager/manager"
import type { ResolvedChildPlan } from "../manager/types"
import { cleanupProjects, settings, tempProject } from "../manager/__fixtures__/manager-fakes"
import { CLAUDE, createParentModelWorld, GPT, type ParentModelWorld } from "../manager/__fixtures__/parent-model-world"
import { createTaskRecordStore } from "../store"
import { compileDag, type DagDefinition } from "./graph"
import { createDagManager, type DagRunRecordV1 } from "./manager"
import { createDagRecovery } from "./recovery"
import { createDagScheduler } from "./scheduler"
import { createDagFileStore } from "./store"
import type { DagRunId } from "./types"

const PRIMARY = `${CLAUDE}/primary`
const PARENT = `${GPT}/parent`
const parentSessionId = "session-dag-parent-model"

const claudeOnly: ResolvedChildPlan = {
  model: PRIMARY,
  category: "unspecified-high",
  requested_model: { source: "category", provider: CLAUDE, model_id: "primary", display: PRIMARY },
  resolved_model: { source: "category", provider: CLAUDE, model_id: "primary", display: PRIMARY },
  fallback_models: [],
}

const definition: DagDefinition = {
  key: "parent-model-rung",
  name: "parent model rung",
  nodes: [{ id: "only", prompt: "do only", category: "unspecified-high" }],
}

let world: ParentModelWorld | undefined
afterEach(() => {
  world?.dispose()
  world = undefined
  cleanupProjects()
})

async function fixture() {
  world = await createParentModelWorld({ [PRIMARY]: ["quota"] })
  const project = tempProject()
  const runner = world.runner()
  const taskManager = createTaskManager({
    store: createTaskRecordStore({ project_dir: project }),
    runners: { "in-process": runner, process: runner },
    planner: () => ({ kind: "resolved", plan: claudeOnly }),
    config: settings({ default_concurrency: 2, max_depth: 1 }),
    cwd: project,
    destruction: { destroyResidentTask: async () => {} },
  })
  return { world, taskManager, store: createDagFileStore({ project_dir: project }) }
}

describe("a workflow category node whose chain is spent runs on the parent's model (#10783)", () => {
  test("#given a run started from a parent on GPT #when the node's Claude-only chain hits its usage limit #then the node completes on the captured parent model", async () => {
    // given
    const { world, taskManager, store } = await fixture()
    const dag = createDagManager({ store, newRunId: () => "dag-parent-model" as DagRunId })
    const started = await dag.start({ definition, parentSessionId, rootSessionId: parentSessionId, parentModel: PARENT })

    // when
    try {
      const settled = await createDagScheduler({
        store,
        taskManager,
        initialRecord: dag.record(started.snapshot.runId, parentSessionId),
      }).run()

      // then
      const taskId = settled.nodes[0]?.taskId
      if (taskId === undefined) throw new Error("node never attached a task")
      const record = taskManager.get(taskId)
      expect(settled.nodes.map((node) => `${node.id}:${node.state}`)).toEqual(["only:completed"])
      expect(world.calls.map((call) => call.model)).toEqual([PRIMARY, PARENT])
      expect(record?.final_response).toBe(`${PARENT} completed`)
      expect(record?.parent_model).toBe(PARENT)
      expect(record?.parent_model_fallback?.reason).toBe("usage_limit")
      expect(settled.parentModel).toBe(PARENT)
    } finally {
      taskManager.workpools.dispose()
    }
  }, 30_000)

  test("#given a paused run that captured the parent model #when recovery starts its never-dispatched node #then the node keeps the parent rung and completes on it", async () => {
    // given
    const { world, taskManager, store } = await fixture()
    const runId = "dag-recovered" as DagRunId
    store.writeCheckpoint(runId, pausedRecord(runId))

    // when
    try {
      const [outcome] = await createDagRecovery({ store, taskManager, hostPid: 101, isProcessAlive: () => false })
        .resumePausedRuns(parentSessionId)

      // then
      expect(outcome?.kind).toBe("resumed")
      const taskId = outcome?.record?.nodes[0]?.taskId
      if (taskId === undefined) throw new Error("recovered node never attached a task")
      const record = await taskManager.waitFor(taskId)
      expect(world.calls.map((call) => call.model)).toEqual([PRIMARY, PARENT])
      expect(record.final_response).toBe(`${PARENT} completed`)
      expect(record.parent_model).toBe(PARENT)
    } finally {
      taskManager.workpools.dispose()
    }
  }, 30_000)
})

function pausedRecord(runId: DagRunId): DagRunRecordV1 {
  const at = "2026-10-27T00:00:00.000Z"
  const compiled = compileDag(definition, { at })
  if (!compiled.ok) throw new Error("test DAG did not compile")
  return {
    schemaVersion: 1,
    checkpointSeq: 0,
    runId,
    runKey: definition.key,
    name: definition.name,
    parentSessionId,
    rootSessionId: parentSessionId,
    parentModel: PARENT,
    definitionFingerprint: "definition-fingerprint",
    definition: { ...definition, nodes: definition.nodes.map((node) => ({ ...node, effectivePrompt: node.prompt })) },
    status: "paused",
    generation: 1,
    createdAt: at,
    updatedAt: at,
    nodes: compiled.nodes.map((node) => ({ ...node, state: "scheduled" as const })),
    edges: compiled.edges,
    waves: compiled.waves,
    criticalPath: compiled.criticalPath,
    bottlenecks: compiled.bottlenecks,
    diagnostics: compiled.diagnostics,
    previousLeaseHolderPid: 2_147_483_647,
  }
}
