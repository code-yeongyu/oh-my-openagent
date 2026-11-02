import { afterEach, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { cleanupProjects } from "../manager/__fixtures__/manager-fakes"
import { R0_DAG_NODE_STATES, r0CountNodes } from "./__fixtures__/r0-ebd01f84e-dag-nodes"
import { pausedRun } from "./__fixtures__/paused-run"
import type { DagRunRecordV1 } from "./manager"
import type { DagRunEvent } from "./types"

afterEach(cleanupProjects)

test("M7: a checkpoint holding a paused node uses only node states R0 knows, so R0's counts stay whole numbers", async () => {
  const h = await pausedRun()
  try {
    const raw = JSON.parse(readFileSync(h.store.paths.run(h.runId), "utf8")) as { readonly nodes: readonly { readonly state: string }[] }
    for (const node of raw.nodes) expect(R0_DAG_NODE_STATES).toContain(node.state)
    const counts = r0CountNodes(raw.nodes)
    expect(Object.values(counts).every(Number.isInteger)).toBe(true)
    expect(h.store.readCheckpoint<DagRunRecordV1>(h.runId)?.nodes.find(node => node.id === h.b)?.state).toBe("paused")
  } finally { await h.manager.cancelTask(h.taskId) }
})

test("M7: a journaled transition into paused uses only node states R0 knows and reads back as paused", async () => {
  const h = await pausedRun()
  try {
    const event = {
      schemaVersion: 1, runId: h.runId, seq: 1, at: new Date(0).toISOString(), lane: "boundary",
      type: "dag.node.transitioned", nodeId: h.c, from: "blocked", to: "paused", reason: { kind: "resumed" },
    } as const satisfies DagRunEvent
    h.store.appendEvent(event)
    const line = JSON.parse(readFileSync(h.store.paths.event(h.runId), "utf8").trim().split("\n").at(-1) ?? "{}") as { readonly from: string; readonly to: string }
    expect(R0_DAG_NODE_STATES).toContain(line.to)
    expect(R0_DAG_NODE_STATES).toContain(line.from)
    const [read] = h.store.readEvents(h.runId, 0, { limit: 10 }).events
    expect(read).toMatchObject({ type: "dag.node.transitioned", from: "blocked", to: "paused" })
  } finally { await h.manager.cancelTask(h.taskId) }
})
