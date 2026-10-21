import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { ensurePrivateDirectory, isPublicDirMode } from "./private-dir"
import { createTaskRecordStore } from "./record-store"
import { createTaskRecord } from "../state"

const roots: string[] = []

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-senpi-store-mode-"))
  roots.push(dir)
  return dir
}

function modeOf(path: string): number {
  return statSync(path).mode & 0o7777
}

function record(taskId: string) {
  return {
    ...createTaskRecord({
      parent_session_id: "parent-session",
      root_session_id: "root-session",
      depth: 0,
      execution_mode: "direct",
      model: "gpt-5.2",
      notify_on_terminal: false,
    }),
    task_id: taskId,
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("task store directory modes", () => {
  describe("#given a fresh nested state directory", () => {
    describe("#when the directory is ensured", () => {
      test("#then every directory the call created is 0700", () => {
        const agentDir = join(scratch(), "agent")
        const stateDir = join(agentDir, "projects", "home-workspace-abc12345", "senpi-task")

        expect(ensurePrivateDirectory(stateDir)).toBe(false)

        for (const path of [
          agentDir,
          join(agentDir, "projects"),
          join(agentDir, "projects", "home-workspace-abc12345"),
          stateDir,
        ]) {
          expect(modeOf(path)).toBe(0o700)
        }
      })
    })
  })

  describe("#given a state directory that already exists wider than 0700", () => {
    describe("#when the directory is ensured", () => {
      test("#then the 0755 legacy directory is tightened to 0700", () => {
        const stateDir = join(scratch(), "senpi-task")
        ensurePrivateDirectory(stateDir)
        chmodSync(stateDir, 0o755)

        expect(ensurePrivateDirectory(stateDir)).toBe(true)
        expect(modeOf(stateDir)).toBe(0o700)
      })

      test("#then a 0777 directory, wider still, is tightened to 0700", () => {
        const stateDir = join(scratch(), "senpi-task")
        ensurePrivateDirectory(stateDir)
        chmodSync(stateDir, 0o777)

        expect(ensurePrivateDirectory(stateDir)).toBe(true)
        expect(modeOf(stateDir)).toBe(0o700)
      })
    })
  })

  describe("#given a directory that is already private", () => {
    describe("#when the directory is ensured", () => {
      test("#then the call is a no-op and reports nothing tightened", () => {
        const stateDir = join(scratch(), "senpi-task")
        ensurePrivateDirectory(stateDir)

        expect(ensurePrivateDirectory(stateDir)).toBe(false)
        expect(modeOf(stateDir)).toBe(0o700)
      })
    })
  })

  describe("#given a store whose state directory is a legacy 0755 tree", () => {
    describe("#when a tombstone runs against a record that was never written", () => {
      // The state directory is pre-existing here, so tightening it is the migration's job, not the
      // store's. What the store owns is the `tasks` directory it creates: it must not inherit 0755.
      test("#then the tasks directory the store creates is 0700", () => {
        const stateDir = join(scratch(), "senpi-task")
        const store = createTaskRecordStore({ project_dir: scratch(), task: { state_dir: stateDir } })
        mkdirSync(stateDir, { recursive: true })
        chmodSync(stateDir, 0o755)

        store.tombstoneIfExpired("st_deadbeef", () => false)

        expect(modeOf(join(stateDir, "tasks"))).toBe(0o700)
      })
    })
  })

  describe("#given a mode", () => {
    describe("#when it is classified", () => {
      test("#then only group or other bits count as public", () => {
        expect(isPublicDirMode(0o755)).toBe(true)
        expect(isPublicDirMode(0o750)).toBe(true)
        expect(isPublicDirMode(0o770)).toBe(true)
        expect(isPublicDirMode(0o700)).toBe(false)
      })
    })
  })

  describe("#given a record already on disk", () => {
    describe("#when the state directory is ensured again", () => {
      test("#then the record file keeps its own mode", () => {
        const stateDir = join(scratch(), "senpi-task")
        const store = createTaskRecordStore({ project_dir: scratch(), task: { state_dir: stateDir } })
        store.save(record("st_00000001"))
        const recordPath = join(stateDir, "tasks", "st_00000001.json")
        chmodSync(recordPath, 0o644)

        expect(ensurePrivateDirectory(stateDir)).toBe(false)
        expect(modeOf(recordPath)).toBe(0o644)
      })
    })
  })
})