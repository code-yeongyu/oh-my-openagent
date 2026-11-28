import { afterEach, expect, test } from "bun:test"

import type { DagTaskOwner } from "../dag/owner"
import type { DagNodeId, DagRunId } from "../dag/types"
import { baseSpec, cleanupProjects, makeManager } from "./__fixtures__/manager-fakes"

afterEach(cleanupProjects)

const key = { kind: "dag", runId: "run-1" as DagRunId, nodeId: "node-1" as DagNodeId } as const
const attempt = (execAttempt: number): DagTaskOwner => ({
  ...key,
  execAttempt,
  fingerprint: `fingerprint-${execAttempt}`,
})

// Delta review of #15135, finding 2: the owned start reused a matching newest claim without looking
// at the other claims, so a stale older child that was live survived the reuse of a settled current
// record and its node's dependents were admitted beside it.
test("#11381 #given a settled current claim and a live claim of an older attempt #when the current attempt starts again #then reuse is refused with owner_conflict naming the live stale claim", async () => {
  // given
  const { manager, store } = makeManager()
  const stale = await manager.startOwned(baseSpec(), attempt(0))
  if (stale.kind !== "started") throw new Error(`unexpected start: ${stale.kind}`)
  store.mutate(stale.task_id, (record) => ({ ...record, status: "completed" }))
  const current = await manager.startOwned(baseSpec(), attempt(1))
  if (current.kind !== "started") throw new Error(`unexpected start: ${current.kind}`)
  store.mutate(current.task_id, (record) => ({ ...record, status: "completed" }))
  store.mutate(stale.task_id, (record) => ({ ...record, status: "running" }))

  // when
  const again = await manager.startOwned(baseSpec(), attempt(1))

  // then
  expect(again).toMatchObject({ kind: "owner_conflict", task_id: stale.task_id })
})
