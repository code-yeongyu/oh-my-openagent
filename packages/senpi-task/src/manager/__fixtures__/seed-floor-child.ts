import { strict as assert } from "node:assert"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { TaskRecord } from "../../state"
import { createTaskRecordStore } from "../../store"
import { createTaskManager } from "../manager"
import { FakeRunner, baseSpec, categoryPlanner, settings } from "./manager-fakes"

const mode = process.argv[2]

function record(taskId: string): TaskRecord {
  return {
    task_id: taskId,
    status: "pending",
    residency_state: "resident",
    parent_session_id: "parent-session",
    root_session_id: "root-session",
    depth: 1,
    execution_mode: "in-process",
    model: "test/model",
    name: taskId,
    created_at: "2026-07-20T00:00:00.000Z",
    updated_at: "2026-07-20T00:00:00.000Z",
    notification: { run_epoch: 0, notified_epoch: -1 },
  }
}

function makeManager(project: string) {
  const store = createTaskRecordStore({ project_dir: project })
  const inProcess = new FakeRunner()
  const process = new FakeRunner()
  const manager = createTaskManager({
    store,
    runners: { "in-process": inProcess, process },
    planner: categoryPlanner(),
    config: settings({ default_concurrency: 5, max_depth: 1 }),
    cwd: project,
  })
  return { manager, store }
}

async function run(): Promise<void> {
  const project = mkdtempSync(join(tmpdir(), "senpi-task-seed-floor-"))
  try {
    switch (mode) {
      case "seed": {
        const store = createTaskRecordStore({ project_dir: project })
        store.save(record("st_7fffff00"))
        const { manager } = makeManager(project)
        const result = await manager.start(baseSpec())
        assert.equal(result.kind, "started")
        assert.equal(result.task_id, "st_7fffff01")
        break
      }
      case "warm-cache": {
        const store = createTaskRecordStore({ project_dir: project })
        store.list()
        mkdirSync(join(store.stateDir, "tasks"), { recursive: true })
        writeFileSync(join(store.stateDir, "tasks", "st_7fffff10.json"), JSON.stringify(record("st_7fffff10")), "utf8")
        const inProcess = new FakeRunner()
        const process = new FakeRunner()
        const manager = createTaskManager({
          store,
          runners: { "in-process": inProcess, process },
          planner: categoryPlanner(),
          config: settings({ default_concurrency: 5, max_depth: 1 }),
          cwd: project,
        })
        const result = await manager.start(baseSpec())
        assert.equal(result.kind, "started")
        assert.equal(result.task_id, "st_7fffff11")
        break
      }
      case "diagnostics": {
        const store = createTaskRecordStore({ project_dir: project })
        store.save(record("st_00000020"))
        mkdirSync(join(store.stateDir, "tasks"), { recursive: true })
        writeFileSync(join(store.stateDir, "tasks", "broken.json"), "{not-json", "utf8")
        const { manager } = makeManager(project)
        const result = await manager.start(baseSpec())
        assert.equal(result.kind, "started")
        break
      }
      default:
        throw new Error(`Unknown mode: ${mode ?? "undefined"}`)
    }
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
}

run().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
