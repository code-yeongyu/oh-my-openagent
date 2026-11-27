import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { dagFingerprint, ownerFingerprintInput } from "./fingerprint"
import { createDagRecovery } from "./recovery"
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

// Delta review of #15135, finding 2: recovery returned the current claim before it looked at older
// live claims, so reconciliation re-attached it beside a stale child whose stop then failed. The
// stale child is live as if it reopened before the fence could refuse it (resumeFence: false).
test("#11381 #given a current claim and a stale live sibling whose stop cannot land #when the run recovers #then the node fails closed before the current child is attached", async () => {
  // given
  const root = fs.mkdtempSync(join(tmpdir(), "senpi-dag-recovery-sibling-"))
  roots.push(root)
  const runner = new ControlledRunner(undefined, { connectable: true })
  const fixture = createE2eFixture({
    project: root,
    runner,
    materializeSkills: identityMaterializer,
    resumeFence: false,
  })
  const started = await fixture.start(definition("recovery-sibling", [categoryNode("A")]))
  const runId = started.snapshot.runId
  await runner.whenStarted(1)
  const staleChild = runner.child("A")
  runner.settle("A", completed("A"))
  await fixture.wait(runId)
  const stale = fixture.taskManager.findOwnedTask({ kind: "dag", runId, nodeId: "A" as DagNodeId })?.task_id
  if (stale === undefined) throw new Error("node A owns no task")
  const settled = fixture.manager.record(runId, parentSessionId)
  const owner = { kind: "dag", runId, nodeId: "A" as DagNodeId, execAttempt: 1 } as const
  const fingerprint = dagFingerprint(
    ownerFingerprintInput({
      definitionFingerprint: settled.definitionFingerprint,
      nodeId: owner.nodeId,
      execAttempt: 1,
    }),
  )
  const spec = { prompt: "do A", parent_session_id: parentSessionId, root_session_id: rootSessionId, depth: 1 }
  const current = await fixture.taskManager.startOwned(
    { ...spec, category: "quick", name: "A", run_in_background: true },
    { ...owner, fingerprint },
  )
  if (current.kind !== "started") throw new Error(`unexpected start: ${current.kind}`)
  await staleChild.selfResume()
  staleChild.connection.lose()
  fixture.store.writeCheckpoint(runId, {
    ...settled,
    status: "paused",
    nodes: settled.nodes.map((node) => ({
      ...node,
      state: "running" as const,
      execAttempt: 1,
      taskId: current.task_id,
    })),
  })

  // when
  await createDagRecovery({ store: fixture.store, taskManager: fixture.taskManager }).installPausedRuns(
    parentSessionId,
    () => undefined,
  )

  // then
  const node = fixture.store.readCheckpoint<typeof settled>(runId)?.nodes[0]
  expect(node).toMatchObject({ state: "failed", error: { code: "stale_attempt_alive" } })
  expect(fixture.taskStore.load(stale)?.status).toBe("running")
})
