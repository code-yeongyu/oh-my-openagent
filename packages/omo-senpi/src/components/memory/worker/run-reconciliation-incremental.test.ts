import { afterEach, expect, test } from "bun:test"
import { cp, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

import type { MemoryReceiptInput } from "@oh-my-opencode/memory-core"

import { reconcileReflectionRuns } from "./run-reconciliation"
import { writeRunJsonAtomic } from "./run-artifacts"
import {
  cleanupReconciliationFixtures,
  reconciliationFixture as fixture,
  retireRunGeneration,
} from "./run-reconciliation.test-support"

afterEach(cleanupReconciliationFixtures)

// Incremental recovery (#12355): a terminal run never changes again, so a pass must not re-read and
// re-append the receipt of every run the identity ever kept.
async function finalizedRuns(count: number) {
  const item = await fixture()
  await retireRunGeneration(item, "2026-08-10T00:10:00.000Z")
  const runsDir = join(item.identity.paths.reflection, "runs")
  const runIds: string[] = []
  for (let index = 0; index < count; index += 1) {
    const runId = `run-finished-${index}`
    const runDir = join(runsDir, runId)
    await cp(item.runDir, runDir, { recursive: true })
    for (const file of ["ledger.json", "final.json"]) {
      const path = join(runDir, file)
      await writeFile(path, JSON.stringify({ ...JSON.parse(await readFile(path, "utf8")), runId }))
    }
    runIds.push(runId)
  }
  const appended: string[] = []
  const passes: number[] = []
  const pass = () => reconcileReflectionRuns({
    identity: item.identity,
    reservation: item.store,
    deferOnSchedulerContention: true,
    receipts: { append: async (_runtimeDir: string, input: MemoryReceiptInput) => { appended.push(input.kind === "facts" ? input.batchId : input.runId); return true } },
    onPassComplete: ({ unsettledRuns }) => { passes.push(unsettledRuns) },
  })
  return { item, runsDir, runIds, appended, passes, pass }
}

test("#given terminal runs whose receipts a pass backfilled #when the next pass runs #then it does no backfill work", async () => {
  // given
  const runs = await finalizedRuns(3)
  await runs.pass()
  expect(runs.appended.toSorted()).toEqual([...runs.runIds, runs.item.ledger.runId].toSorted())

  // when
  runs.appended.length = 0
  await runs.pass()

  // then
  expect(runs.appended).toEqual([])
  expect(runs.passes).toEqual([0, 0])
})

test("#given a reconciled run whose ledger is rewritten by a new generation #when the next pass runs #then that run is backfilled again", async () => {
  // given
  const runs = await finalizedRuns(2)
  await runs.pass()
  runs.appended.length = 0
  const [rewritten] = runs.runIds
  if (rewritten === undefined) throw new Error("fixture has no run")
  const ledgerPath = join(runs.runsDir, rewritten, "ledger.json")
  const ledger: unknown = JSON.parse(await readFile(ledgerPath, "utf8"))
  await writeRunJsonAtomic(ledgerPath, { ...(ledger as object), startedAt: "2026-08-11T00:00:00.000Z" })

  // when
  await runs.pass()

  // then
  expect(runs.appended).toEqual([rewritten])
})
