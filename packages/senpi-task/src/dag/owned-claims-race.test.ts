import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { DagNodeId } from "./types"
import { RetryClock } from "./infra-retry-fixture"
import {
  ControlledRunner,
  categoryNode,
  completed,
  createE2eFixture,
  definition,
  identityMaterializer,
  infrastructureFailed,
} from "./__fixtures__/controlled-dag-e2e"

setDefaultTimeout(process.platform === "win32" ? 60_000 : 20_000)

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function project(): string {
  const root = fs.mkdtempSync(join(tmpdir(), "senpi-dag-owned-claims-"))
  roots.push(root)
  return root
}

// Review finding 3 of #15135: the re-entry sweep runs once, so an older attempt's child that resumes
// on its own AFTER it is hidden behind a newer, already terminal claim. The owned start must see every
// live claim of the node, not only the newest record, or the automatic retry adds a third writer.
test("#11381 #given an older attempt's child that resumed after the sweep behind a newer terminal claim #when the infrastructure retry admits the node #then no new child starts beside it and it is stopped", async () => {
  // given
  const clock = new RetryClock()
  const runner = new ControlledRunner()
  const fixture = createE2eFixture({
    project: project(),
    runner,
    materializeSkills: identityMaterializer,
    scheduleRetry: clock.schedule,
  })
  const started = await fixture.start(definition("older-live-claim", [categoryNode("A")]))
  const runId = started.snapshot.runId
  await runner.whenStarted(1)
  runner.settle("A", completed("A"))
  await fixture.wait(runId)
  const oldest = fixture.taskManager.findOwnedTask({ kind: "dag", runId, nodeId: "A" as DagNodeId })?.task_id
  if (oldest === undefined) throw new Error("node A owns no task")
  const reentry = await fixture.amend(
    definition("older-live-claim", [categoryNode("A", [], { prompt: "do A-fixed" })]),
    runId,
  )
  await runner.whenStarted(2)
  await runner.selfResume("A")
  expect(fixture.taskStore.load(oldest)?.status).toBe("running")
  const retryScheduled = clock.whenScheduled(1)
  runner.settle("A-fixed", infrastructureFailed("A-fixed"))
  await retryScheduled

  // when
  clock.advance()
  await Promise.race([reentry.run, runner.whenStarted(3)])

  // then
  expect(runner.startedSpecs.map((spec) => spec.prompt)).toEqual(["do A", "do A-fixed"])
  const record = await reentry.run
  expect(record.nodes.find((entry) => entry.id === "A")).toMatchObject({
    state: "failed",
    error: { code: "stale_attempt_alive" },
  })
  expect(fixture.taskStore.load(oldest)?.status).toBe("cancelled")
})
