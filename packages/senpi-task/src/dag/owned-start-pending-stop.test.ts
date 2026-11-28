import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { DestructionPort } from "../steering"
import { dagFingerprint, ownerFingerprintInput } from "./fingerprint"
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

// Class-table cell "refused run, stop not confirmed" x "owned start" (delta review 2 of #15135): the
// refused turn's record stays settled while its stop is pending, so the manager's own claim fence must
// count it live through the same rule the DAG side uses, or a fresh child starts beside the turn.
test("#11381 #given a superseded claim whose refused turn's teardown is still pending #when the node's next attempt starts #then the manager refuses with owner_conflict instead of starting beside it", async () => {
  // given
  let release = (): void => undefined
  let reached = (): void => undefined
  const torn = new Promise<void>((resolve) => (reached = resolve))
  const gate = new Promise<void>((resolve) => (release = resolve))
  const destruction: DestructionPort = {
    destroyResidentTask: async () => {
      reached()
      await gate
    },
  }
  const root = fs.mkdtempSync(join(tmpdir(), "senpi-dag-owned-start-pending-"))
  roots.push(root)
  const runner = new ControlledRunner()
  const fixture = createE2eFixture({ project: root, runner, materializeSkills: identityMaterializer, destruction })
  const started = await fixture.start(definition("owned-start-pending", [categoryNode("A")]))
  const runId = started.snapshot.runId
  await runner.whenStarted(1)
  runner.settle("A", completed("A"))
  await fixture.wait(runId)
  const old = fixture.taskManager.findOwnedTask({ kind: "dag", runId, nodeId: "A" as DagNodeId })?.task_id
  const record = fixture.manager.record(runId, parentSessionId)
  fixture.store.writeCheckpoint(runId, {
    ...record,
    status: "running",
    nodes: record.nodes.map((node) => ({ ...node, state: "pending" as const, execAttempt: 1 })),
  })
  void runner.selfResume("A")
  await torn

  // when
  const fingerprint = dagFingerprint(
    ownerFingerprintInput({
      definitionFingerprint: record.definitionFingerprint,
      nodeId: "A" as DagNodeId,
      execAttempt: 1,
    }),
  )
  const next = await fixture.taskManager.startOwned(
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
  release()

  // then
  expect(next).toMatchObject({ kind: "owner_conflict", task_id: old })
  expect(runner.startedSpecs).toHaveLength(1)
})
