import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { makeRecord } from "../tools/output/__fixtures__/records"
import type { TaskRecord } from "../state"
import { parseR0PersistedReasons } from "./__fixtures__/r0-ebd01f84e-reasons"
import { parseTaskRecord } from "./record-parse"
import { writeRecord } from "./record-write"

function writeAndReadRaw(record: TaskRecord): Record<string, unknown> {
  const dir = mkdtempSync(join(tmpdir(), "paused-status-encoding-"))
  const path = join(dir, "tasks", `${record.task_id}.json`)
  try {
    writeRecord(path, record, "create", process.platform)
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe("paused status stored encoding (R0 rollback compatibility)", () => {
  const paused: TaskRecord = {
    ...makeRecord({ task_id: "st_0000a0c1", status: "running" }),
    status: "paused",
    run_pause: { parent_session_id: "parent-1", parent_pause_seq: 2, run_ref: { kind: "task", id: "st_0000a0c1" } },
  }

  test("#given a paused task written by this build #when R0 reads the bytes #then it loads them as a running task", () => {
    const stored = writeAndReadRaw(paused)
    expect(stored).toMatchObject({ status: "running", paused: true })
    expect(() => parseR0PersistedReasons(stored)).not.toThrow()
  })

  test("#given those bytes #when this build reads them #then the task is paused with its run owner", () => {
    expect(parseTaskRecord(writeAndReadRaw(paused), "record.json")).toMatchObject({
      status: "paused", run_pause: paused.run_pause,
    })
  })

  test("#given a running task #when written and read back #then it stays running with no pause marker", () => {
    const running = makeRecord({ task_id: "st_0000a0c2", status: "running" })
    const stored = writeAndReadRaw(running)
    expect(stored.paused).toBeUndefined()
    expect(parseTaskRecord(stored, "record.json").status).toBe("running")
  })
})
