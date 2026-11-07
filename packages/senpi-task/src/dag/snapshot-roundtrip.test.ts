import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { DagDefinition, DagNodeInput } from "./graph"
import { createDagManager, type DagRunRecordV1 } from "./manager"
import { createDagFileStore } from "./store"
import type { DagRunId, DagRunSnapshot } from "./types"

const cleanupRoots: string[] = []
const parentSessionId = "ses_parent"
const rootSessionId = "ses_root"

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function setup() {
  const directory = fs.mkdtempSync(join(tmpdir(), "senpi-dag-snapshot-roundtrip-"))
  cleanupRoots.push(directory)
  const store = createDagFileStore({ project_dir: directory })
  let counter = 0
  const dag = createDagManager({ store, newRunId: () => `run-${++counter}` as DagRunId })
  return { store, dag }
}

const producers: DagDefinition = {
  key: "producers",
  name: "producers",
  nodes: [
    { id: "a", prompt: "produce a", category: "quick", task_summary: "Produce A", description: "first producer", load_skills: ["git-master"] },
    { id: "b", prompt: "produce b", subagent_type: "explore", task_summary: "Produce B", dependsOn: ["a"] },
  ],
}

function completeAll(store: ReturnType<typeof createDagFileStore>, runId: DagRunId): void {
  const record = store.readCheckpoint<DagRunRecordV1>(runId)
  if (record === null) throw new Error("missing test checkpoint")
  store.writeCheckpoint(runId, {
    ...record,
    status: "completed",
    completedAt: "2026-01-01T00:01:00.000Z",
    nodes: record.nodes.map((node) => ({ ...node, state: "completed" as const, taskId: `task-${node.id}`, attempt: 1 })),
  })
}

function definitionFromSnapshot(snapshot: DagRunSnapshot): DagDefinition {
  return {
    key: snapshot.runKey,
    name: snapshot.name,
    nodes: snapshot.nodes.map((node): DagNodeInput => {
      const common = {
        id: node.id,
        prompt: node.prompt,
        ...(node.label === undefined ? {} : { label: node.label }),
        ...(node.dependsOn.length === 0 ? {} : { dependsOn: node.dependsOn }),
        ...(node.task_summary === undefined ? {} : { task_summary: node.task_summary }),
        ...(node.description === undefined ? {} : { description: node.description }),
        ...(node.load_skills === undefined ? {} : { load_skills: node.load_skills }),
      }
      return node.route.kind === "category"
        ? { ...common, category: node.route.category }
        : { ...common, subagent_type: node.route.agent, ...(node.route.model === undefined ? {} : { model: node.route.model }) }
    }),
  }
}

describe("dag snapshot round-trip (#9992)", () => {
  test("#given a run whose nodes carry task_summary, description and load_skills #when its snapshot is read #then each node carries them", async () => {
    const { dag } = setup()
    const started = await dag.start({ definition: producers, parentSessionId, rootSessionId })

    const nodes = dag.snapshot(started.snapshot.runId, parentSessionId).nodes

    expect(nodes.map((node) => [node.id, node.task_summary, node.description, node.load_skills])).toEqual([
      ["a", "Produce A", "first producer", ["git-master"]],
      ["b", "Produce B", undefined, undefined],
    ])
  })

  test("#given a completed run #when a definition rebuilt from its snapshot is amended #then no node is invalidated", async () => {
    const { store, dag } = setup()
    const started = await dag.start({ definition: producers, parentSessionId, rootSessionId })
    completeAll(store, started.snapshot.runId)
    const rebuilt = definitionFromSnapshot(dag.snapshot(started.snapshot.runId, parentSessionId))

    const amended = await dag.amend({ runId: started.snapshot.runId, definition: rebuilt, parentSessionId })

    expect(amended.definitionFingerprint).toBe(started.snapshot.definitionFingerprint)
    expect(amended.nodes.map((node) => node.state)).toEqual(["completed", "completed"])
  })
})
