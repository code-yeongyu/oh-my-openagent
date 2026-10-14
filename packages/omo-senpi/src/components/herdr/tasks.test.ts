import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { countRunningChildTasks } from "./tasks"

function fixture(files: Record<string, string>): { cwd: string; cleanup: () => void } {
  const cwd = mkdtempSync(join(tmpdir(), "herdr-tasks-"))
  const dir = join(cwd, ".omo", "senpi-task", "tasks")
  mkdirSync(dir, { recursive: true })
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content)
  }
  return { cwd, cleanup: () => rmSync(cwd, { recursive: true, force: true }) }
}

describe("countRunningChildTasks", () => {
  test("#given running and pending records owned by the session #then they count", () => {
    const { cwd, cleanup } = fixture({
      "a.json": JSON.stringify({ status: "running", root_session_id: "s1" }),
      "b.json": JSON.stringify({ status: "pending", parent_session_id: "s1" }),
      "c.json": JSON.stringify({ status: "completed", root_session_id: "s1" }),
      "d.json": JSON.stringify({ status: "running", root_session_id: "other" }),
      "e.json": JSON.stringify({ status: "running" }),
      "notes.txt": "not a record",
      "broken.json": "{ not json",
    })
    try {
      expect(countRunningChildTasks(cwd, "s1")).toBe(2)
    } finally {
      cleanup()
    }
  })

  test("#given no task directory #then it counts zero without throwing", () => {
    const cwd = mkdtempSync(join(tmpdir(), "herdr-tasks-empty-"))
    try {
      expect(countRunningChildTasks(cwd, "s1")).toBe(0)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test("#given no session id #then nothing matches", () => {
    const { cwd, cleanup } = fixture({
      "a.json": JSON.stringify({ status: "running", root_session_id: "s1" }),
    })
    try {
      expect(countRunningChildTasks(cwd, undefined)).toBe(0)
    } finally {
      cleanup()
    }
  })

  test("#given an unreadable directory #then it counts zero and logs", () => {
    const debug: string[] = []
    const count = countRunningChildTasks("/nowhere", "s1", {
      readdir: () => {
        throw new Error("EACCES")
      },
      debug: (m) => debug.push(m),
    })
    expect(count).toBe(0)
    expect(debug).toHaveLength(1)
  })
})
