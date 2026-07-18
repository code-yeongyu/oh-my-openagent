/// <reference path="../../../bun-test.d.ts" />

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import {
  createBoulderState,
  readBoulderState,
  upsertTaskSessionStateForWork,
  writeBoulderState,
} from "./index"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe("task session state", () => {
  test("#given reserved task keys #when upserting task sessions #then prototype-polluting keys are rejected", () => {
    // given
    const directory = mkdtempSync(join(tmpdir(), "boulder-task-state-"))
    cleanupRoots.push(directory)
    const state = createBoulderState(".omo/plans/prototype-guard.md", "sess-a")
    const workId = state.active_work_id
    expect(workId).toBeDefined()
    expect(writeBoulderState(directory, state)).toBe(true)

    // when
    const results = ["__proto__", "prototype", "constructor"].map((taskKey) =>
      upsertTaskSessionStateForWork(directory, workId ?? "", {
        taskKey,
        taskLabel: taskKey,
        taskTitle: `Task ${taskKey}`,
        sessionId: "sess-task",
      }),
    )
    const storedState = readBoulderState(directory)
    const storedWork = workId ? storedState?.works?.[workId] : undefined

    // then
    expect(results).toEqual([null, null, null])
    expect(storedWork?.task_sessions).toEqual({})
    expect(storedState?.task_sessions).toEqual({})
  })
})
