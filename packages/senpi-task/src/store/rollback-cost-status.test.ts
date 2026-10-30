import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createTaskRecord } from "../state"
import { parseR0PersistedReasons } from "./__fixtures__/r0-ebd01f84e-reasons"
import { createTaskRecordStore } from "./record-store"
import { migrateHostSessionSockets } from "./rollback-migrate"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("rollback preparation keeps a partial cost readable by R0 (#10724)", () => {
  test("#given a run whose cost is partial #when rollback prepares #then R0 reads it as reported with its figure intact", () => {
    // given
    const storeDir = mkdtempSync(join(tmpdir(), "senpi-task-rollback-cost-"))
    roots.push(storeDir)
    const store = createTaskRecordStore({ project_dir: storeDir, task: { state_dir: storeDir } })
    const record = createTaskRecord({ parent_session_id: "p", root_session_id: "p", depth: 1, execution_mode: "in-process", model: "test/model", notify_on_terminal: false })
    store.save({ ...record, status: "completed", run_stats: { runtime_ms: 1, turns: 2, tool_calls: 0, cost_usd: 0.5, cost_status: "partial", token_status: "partial" } })

    // when
    const result = migrateHostSessionSockets(storeDir, { to: "/tmp/rpc.sock", deadEndpoints: new Set() })

    // then
    const raw = JSON.parse(readFileSync(join(storeDir, "tasks", `${record.task_id}.json`), "utf8"))
    expect(result.migrated).toBe(1)
    expect(() => parseR0PersistedReasons(raw)).not.toThrow()
    expect(raw.run_stats.cost_status).toBe("reported")
    expect(raw.run_stats.cost_usd).toBe(0.5)
  })
})
