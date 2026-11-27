import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { dagFingerprint, ownerFingerprintInput } from "./fingerprint"
import { resolveRecoveredNodeTask } from "./recovery-attempt"
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

// Delta review 2 of #15135, finding 4: recovery captured the current claim before awaiting the stale
// sibling's stop and returned that old snapshot, so a current child that settled during the stop was
// re-attached as running instead of folded from its durable outcome.
test("#11381 #given a current child that settles while a stale sibling's stop is held #when recovery resolves the node #then it returns the settled record, not the pre-stop snapshot", async () => {
  // given
  const root = fs.mkdtempSync(join(tmpdir(), "senpi-dag-recovery-reread-"))
  roots.push(root)
  const runner = new ControlledRunner()
  const fixture = createE2eFixture({
    project: root,
    runner,
    materializeSkills: identityMaterializer,
    resumeFence: false,
  })
  const started = await fixture.start(definition("recovery-reread", [categoryNode("A")]))
  const runId = started.snapshot.runId
  await runner.whenStarted(1)
  const staleChild = runner.child("A")
  runner.settle("A", completed("A"))
  await fixture.wait(runId)
  const settled = fixture.manager.record(runId, parentSessionId)
  const fingerprint = dagFingerprint(
    ownerFingerprintInput({
      definitionFingerprint: settled.definitionFingerprint,
      nodeId: "A" as DagNodeId,
      execAttempt: 1,
    }),
  )
  const current = await fixture.taskManager.startOwned(
    {
      prompt: "do A",
      parent_session_id: parentSessionId,
      root_session_id: rootSessionId,
      depth: 1,
      category: "quick",
      name: "A",
      run_in_background: true,
    },
    { kind: "dag", runId, nodeId: "A" as DagNodeId, execAttempt: 1, fingerprint },
  )
  if (current.kind !== "started") throw new Error(`unexpected start: ${current.kind}`)
  await staleChild.selfResume()
  const recovered = {
    ...settled,
    status: "paused" as const,
    nodes: settled.nodes.map((node) => ({
      ...node,
      state: "running" as const,
      execAttempt: 1,
      taskId: current.task_id,
    })),
  }
  const nodeA = recovered.nodes[0]
  if (nodeA === undefined) throw new Error("no node A")
  const held = staleChild.holdStops()

  // when
  const resolving = resolveRecoveredNodeTask(fixture.taskManager, recovered, nodeA)
  await held.reached
  runner.settle("A", completed("A again"))
  await fixture.taskManager.waitFor(current.task_id)
  held.release()
  const resolved = await resolving

  // then
  expect(resolved).toMatchObject({ kind: "task", task: { task_id: current.task_id, status: "completed" } })
})
