import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { writeBoulderState } from "../features/boulder-state"

import { writeBeadCheckpoint } from "./bead-checkpoint"

describe("writeBeadCheckpoint", () => {
  const testDirectory = join(tmpdir(), `omo-beads-checkpoint-${Date.now()}`)

  afterEach(() => {
    if (existsSync(testDirectory)) {
      rmSync(testDirectory, { recursive: true, force: true })
    }
  })

  test("writes the full continuation checkpoint payload before boulder clear", () => {
    // given
    mkdirSync(testDirectory, { recursive: true })
    writeBoulderState(testDirectory, {
      active_plan: "/tmp/plan.md",
      started_at: "2026-04-10T10:00:00.000Z",
      session_ids: ["ses-root"],
      plan_name: "plan",
      worktree_path: "/tmp/worktree",
      task_sessions: {
        "todo:1": {
          task_key: "todo:1",
          task_label: "1",
          task_title: "Persist bead state",
          session_id: "ses-child",
          updated_at: "2026-04-10T10:15:00.000Z",
        },
      },
      bead_id: "bd-123",
      bead_source_command: "ock beads attach bd-123",
      bead_worktree_path: "/tmp/worktree",
      bead_last_reconciled_at: "2026-04-10T10:30:00.000Z",
    })

    // when
    writeBeadCheckpoint(testDirectory, "ses-root")

    // then
    const checkpointPath = join(testDirectory, ".beads", "artifacts", "checkpoint-ses-root.json")
    const checkpoint = JSON.parse(readFileSync(checkpointPath, "utf-8")) as Record<string, unknown>

    expect(checkpoint).toMatchObject({
      session_id: "ses-root",
      active_plan: "/tmp/plan.md",
      plan_name: "plan",
      session_ids: ["ses-root"],
      task_sessions: {
        "todo:1": {
          task_key: "todo:1",
          task_label: "1",
          task_title: "Persist bead state",
          session_id: "ses-child",
          updated_at: "2026-04-10T10:15:00.000Z",
        },
      },
      worktree_path: "/tmp/worktree",
      bead_id: "bd-123",
      bead_source_command: "ock beads attach bd-123",
      bead_worktree_path: "/tmp/worktree",
      bead_last_reconciled_at: "2026-04-10T10:30:00.000Z",
    })
    expect(typeof checkpoint["cleared_at"]).toBe("string")
  })
})
