import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createDagRecovery, type InstalledDagRun } from "./recovery"
import type { DagNodeId, DagRunId } from "./types"
import {
  categoryNode,
  createE2eFixture,
  definition,
  identityMaterializer,
  parentSessionId,
  type E2eFixture,
} from "./__fixtures__/controlled-dag-e2e"
import { ControlledRunner, completed, failed } from "./__fixtures__/controlled-runner"

setDefaultTimeout(process.platform === "win32" ? 60_000 : 20_000)

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

// Review finding 2 of #15135: a retry retains the node's taskId and admission journals `scheduled`
// before it starts the replacement. A crash in that window leaves attempt 1 with only attempt 0's
// task. Recovery must validate the attempt before it attaches, folds, or starts anything.
async function crashedBetweenRetryAndStart(selfResumed: boolean) {
  const root = fs.mkdtempSync(join(tmpdir(), "senpi-dag-recovery-fence-"))
  roots.push(root)
  const runner = new ControlledRunner()
  const fixture: E2eFixture = createE2eFixture({ project: root, runner, materializeSkills: identityMaterializer })
  const started = await fixture.start(definition("recovery-attempt-fence", [categoryNode("A")]))
  const runId: DagRunId = started.snapshot.runId
  await runner.whenStarted(1)
  runner.settle("A", failed("A"))
  await fixture.wait(runId)
  const stale = fixture.taskManager.findOwnedTask({ kind: "dag", runId, nodeId: "A" as DagNodeId })?.task_id
  if (stale === undefined) throw new Error("node A owns no task")
  if (selfResumed) await runner.selfResume("A")
  const settled = fixture.store.readCheckpoint<ReturnType<typeof fixture.manager.record>>(runId)
  if (settled === null) throw new Error("run checkpoint missing")
  fixture.store.writeCheckpoint(runId, {
    ...settled,
    status: "paused",
    // Exactly what the retry reducer keeps (run-mutation.ts), then admission's `scheduled`.
    nodes: settled.nodes.map(
      ({ error: _e, completedAt: _c, startedAt: _s, output: _o, outputBytes: _b, runStats: _r, ...node }) => {
        const { resultArtifact: _a, ...kept } = node as typeof node & { readonly resultArtifact?: unknown }
        return { ...kept, state: "scheduled" as const, execAttempt: 1, taskId: stale }
      },
    ),
  })
  const installs: InstalledDagRun[] = []
  await createDagRecovery({ store: fixture.store, taskManager: fixture.taskManager }).installPausedRuns(
    parentSessionId,
    (installed) => installs.push(installed),
  )
  const installed = installs[0]
  if (installed === undefined) throw new Error("recovery installed no run")
  return { fixture, runner, runId, stale, installed }
}

function nodeA(fixture: E2eFixture, runId: DagRunId) {
  return fixture.store.readCheckpoint<ReturnType<typeof fixture.manager.record>>(runId)?.nodes[0]
}

test("#11381 #given a crash after the retry journaled and only the old attempt's settled task exists #when the run recovers #then the old result is never folded and attempt one starts", async () => {
  // given / when
  const { fixture, runner, runId, stale, installed } = await crashedBetweenRetryAndStart(false)

  // then
  expect(nodeA(fixture, runId)).toMatchObject({ state: "running" })
  expect(nodeA(fixture, runId)?.taskId).not.toBe(stale)
  await runner.whenStarted(2)
  runner.settle("A", completed("A"))
  expect((await installed.settled).record?.status).toBe("completed")
})

test("#11381 #given a crash after the retry journaled and the old attempt's child resumed on its own #when the run recovers #then that child is stopped and never re-attached as attempt one", async () => {
  // given / when
  const { fixture, runner, runId, stale, installed } = await crashedBetweenRetryAndStart(true)

  // then
  expect(nodeA(fixture, runId)?.taskId).not.toBe(stale)
  expect(fixture.taskStore.load(stale)?.status).toBe("cancelled")
  await runner.whenStarted(2)
  runner.settle("A", completed("A"))
  expect((await installed.settled).record?.status).toBe("completed")
})
