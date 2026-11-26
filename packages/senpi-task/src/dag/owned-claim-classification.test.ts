import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { dagFingerprint, ownerFingerprintInput } from "./fingerprint"
import type { DagRunRecordV1 } from "./manager"
import type { DagTaskOwner } from "./owner"
import { createDagScheduler } from "./scheduler"
import type { DagNodeId } from "./types"
import {
  categoryNode,
  createE2eFixture,
  definition,
  identityMaterializer,
  parentSessionId,
  rootSessionId,
} from "./__fixtures__/controlled-dag-e2e"
import { ControlledRunner, completed } from "./__fixtures__/controlled-runner"

setDefaultTimeout(process.platform === "win32" ? 60_000 : 20_000)

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

// Review finding 4 of #15135: the manager read an owner without execAttempt as attempt 0 and called
// every other attempt superseded, so admission cancelled a positively identified current legacy child
// (and would cancel a NEWER attempt's child). The real manager drives both cases here.
async function liveChildOfNodeA(owner: (record: DagRunRecordV1) => Omit<DagTaskOwner, "kind" | "runId" | "nodeId">) {
  const root = fs.mkdtempSync(join(tmpdir(), "senpi-dag-owned-legacy-"))
  roots.push(root)
  const runner = new ControlledRunner()
  const fixture = createE2eFixture({ project: root, runner, materializeSkills: identityMaterializer })
  const started = await fixture.manager.start({
    definition: definition("owned-legacy", [categoryNode("A"), categoryNode("B")]),
    parentSessionId,
    rootSessionId,
  })
  const record = fixture.manager.record(started.snapshot.runId, parentSessionId)
  const seeded = await fixture.taskManager.startOwned(
    {
      prompt: "do A",
      parent_session_id: parentSessionId,
      root_session_id: rootSessionId,
      depth: 1,
      category: "quick",
      name: "A",
      run_in_background: true,
    },
    { kind: "dag", runId: record.runId, nodeId: "A" as DagNodeId, ...owner(record) },
  )
  if (seeded.kind !== "started") throw new Error(`unexpected seed: ${seeded.kind}`)
  const prepared: DagRunRecordV1 = {
    ...record,
    amendHistory: [
      {
        at: record.createdAt,
        previousFingerprint: "previous-definition",
        fingerprint: record.definitionFingerprint,
        changedNodeIds: ["B" as DagNodeId],
        addedNodeIds: [],
        invalidatedNodeIds: ["B" as DagNodeId],
      },
    ],
    nodes: record.nodes.map((node) =>
      node.id === "A" ? { ...node, execAttempt: 1 } : { ...node, state: "completed" as const },
    ),
  }
  fixture.store.writeCheckpoint(record.runId, prepared)
  const scheduler = createDagScheduler({
    store: fixture.store,
    taskManager: fixture.taskManager,
    initialRecord: prepared,
  })
  const attached = new Promise<string>((resolve) => {
    const unsubscribe = scheduler.subscribe((event) => {
      if (event.type !== "dag.node.task-attached" || event.nodeId !== "A") return
      unsubscribe()
      resolve(event.taskId)
    })
  })
  return { fixture, runner, scheduler, attached, seeded: seeded.task_id }
}

test("#11381 #given a live legacy child created for attempt one under the previous definition #when an unrelated amend re-admits its node #then that current child is adopted, not cancelled", async () => {
  // given
  const legacy = () => {
    const input = ownerFingerprintInput({
      definitionFingerprint: "previous-definition",
      nodeId: "A" as DagNodeId,
      execAttempt: 1,
    })
    return { fingerprint: dagFingerprint(input) }
  }
  const { fixture, runner, scheduler, attached, seeded } = await liveChildOfNodeA(legacy)

  // when
  const running = scheduler.run()
  const first = await Promise.race([attached, running.then(() => "settled without attaching")])

  // then
  expect(first).toBe(seeded)
  expect(fixture.taskStore.load(seeded)?.status).toBe("running")
  runner.settle("A", completed("A"))
  expect((await running).status).toBe("completed")
})

test("#11381 #given a live child of a NEWER attempt than the node's #when the node is admitted #then that child is never cancelled and the node fails without adopting it", async () => {
  // given
  const newer = (record: DagRunRecordV1) => {
    const input = ownerFingerprintInput({
      definitionFingerprint: record.definitionFingerprint,
      nodeId: "A" as DagNodeId,
      execAttempt: 2,
    })
    return { execAttempt: 2, fingerprint: dagFingerprint(input) }
  }
  const { fixture, scheduler, seeded } = await liveChildOfNodeA(newer)

  // when
  const record = await scheduler.run()

  // then
  expect(fixture.taskStore.load(seeded)?.status).toBe("running")
  expect(record.nodes.find((node) => node.id === "A")).toMatchObject({
    state: "failed",
    error: { code: "start_failed" },
  })
})
