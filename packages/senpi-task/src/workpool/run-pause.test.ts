import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createTaskRecordStore } from "../store"
import { createWorkpoolEngine } from "./engine"
import type { WorkpoolAdmission, WorkpoolRequest } from "./ports"
import type { WorkpoolSpec } from "./types"

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

test("a Stop persists a pool hold, revokes an in-flight assignment and prevents reload from dispatching", async () => {
  const root = mkdtempSync(join(tmpdir(), "pool-hold-"))
  roots.push(root)
  const caller = { sessionId: "parent", rootSessionId: "parent", depth: 0, cwd: root }
  const spec: WorkpoolSpec = {
    plan: { model: "test/model" },
    start: { prompt: "work", parent_session_id: "parent", root_session_id: "parent", depth: 1, cwd: root, execution_mode: "in-process" },
  }
  const requested = Promise.withResolvers<WorkpoolRequest>()
  let requests = 0
  let cancellations = 0
  const admission: WorkpoolAdmission = {
    tasks: createTaskRecordStore({ project_dir: root }),
    resolve: () => spec, hasFreeSlot: () => true,
    request: request => { requests++; requested.resolve(request); return { cancel: () => { cancellations++ } } },
    drain() {}, get: () => undefined, pending: () => false, cancel: async () => undefined,
    waitFor: () => { throw new Error("no worker was started") },
  }
  const engine = createWorkpoolEngine(root, admission)
  const pool = engine.create(caller, { name: "work", agent: { category: "quick", prompt: "work" } })
  engine.push(caller, pool.pool_id, [{ key: "one", input: 1 }])
  const request = await requested.promise
  const generation = engine.inspect(caller, pool.pool_id).generation
  engine.pauseForRun(caller, pool.pool_id, 9)
  expect(request.current()).toBe(false)
  expect(request.bind("st_12345678", 0)).toBe(false)
  expect(cancellations).toBe(1)
  expect(engine.inspect(caller, pool.pool_id)).toMatchObject({
    generation, hold: { reason: "user_stop", pauseSeq: 9 },
    items: [{ status: "queued" }],
  })
  engine.dispose()
  const recovered = createWorkpoolEngine(root, admission)
  recovered.attach(caller)
  await new Promise<void>(resolve => setImmediate(resolve))
  expect(requests).toBe(1)
  expect(recovered.inspect(caller, pool.pool_id).hold?.pauseSeq).toBe(9)
  expect(recovered.resumeForRun(caller, pool.pool_id, 8)).toEqual({ released: false, reason: "stale" })
  recovered.pauseForRun(caller, pool.pool_id, 10)
  expect(recovered.resumeForRun(caller, pool.pool_id, 9)).toEqual({ released: false, reason: "stale" })
  expect(recovered.resumeForRun(caller, pool.pool_id, 10)).toEqual({ released: true })
  recovered.dispose()
})
