import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { R0_WORKPOOL_FILE_NAME, R0WorkpoolRecordSchema } from "./__fixtures__/r0-ebd01f84e-workpool-schema"
import { createWorkpoolStore } from "./store"
import type { WorkpoolSpec } from "./types"

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

const ITEM = "wi_0123456789abcdef0123456789abcdef" as const

function stoppedPool() {
  const root = mkdtempSync(join(tmpdir(), "pool-r0-"))
  roots.push(root)
  const store = createWorkpoolStore(root)
  const caller = { sessionId: "parent", rootSessionId: "parent", depth: 0, cwd: root }
  const spec: WorkpoolSpec = {
    plan: { model: "test/model" },
    start: { prompt: "work", parent_session_id: "parent", root_session_id: "parent", depth: 1, cwd: root, execution_mode: "in-process" },
  }
  const pool = store.create(caller, { name: "work", agent: { category: "quick", prompt: "work" }, mode: "fresh" }, spec)
  store.mutate(pool.pool_id, current => ({
    ...current,
    hold: { reason: "user_stop", pauseSeq: 7 },
    items: [{
      key: "one", input: 1, item_id: ITEM, status: "assigned",
      binding: { task_id: "st_0123abcd", run_epoch: 0, generation: current.generation },
      delivery: { phase: "dispatching", entry_ids: ["entry-1"] },
    }],
    workers: [{ task_id: "st_0123abcd", run_epoch: 0, status: "paused", completed_turns: 0, idle_since: 0 }],
  }))
  return { root, store, poolId: pool.pool_id }
}

test("M7: a pool written while stopped still parses under R0's strict record schema", () => {
  const { root, poolId } = stoppedPool()
  const raw = JSON.parse(readFileSync(join(root, "workpools", `${poolId}.json`), "utf8"))
  expect(() => R0WorkpoolRecordSchema.parse(raw)).not.toThrow()
})

test("M7: this build reads back the hold, the paused worker and the delivery entry ids it wrote", () => {
  const { store, poolId } = stoppedPool()
  const loaded = store.load(poolId)
  expect(loaded.hold).toEqual({ reason: "user_stop", pauseSeq: 7 })
  expect(loaded.workers.map(worker => worker.status)).toEqual(["paused"])
  expect(loaded.items[0]?.delivery).toEqual({ phase: "dispatching", entry_ids: ["entry-1"] })
})

test("M7: every pool file R0 would list parses under R0's schema", () => {
  const { root } = stoppedPool()
  for (const name of readdirSync(join(root, "workpools")).filter(entry => R0_WORKPOOL_FILE_NAME.test(entry))) {
    expect(() => R0WorkpoolRecordSchema.parse(JSON.parse(readFileSync(join(root, "workpools", name), "utf8")))).not.toThrow()
  }
})
