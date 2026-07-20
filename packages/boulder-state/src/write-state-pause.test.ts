/// <reference path="../../../bun-test.d.ts" />

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"

import type { BoulderState, BoulderWorkState } from "./types"
import { readBoulderState } from "./storage/read-state"
import { clearBoulderPause, selectActiveWork, setBoulderPause, writeBoulderState } from "./storage/write-state"

function createTempDirectory(): string {
  return mkdtempSync(join(tmpdir(), "boulder-write-state-pause-"))
}

function writeState(directory: string, state: BoulderState): void {
  const boulderDirectory = join(directory, ".omo")
  mkdirSync(boulderDirectory, { recursive: true })
  writeFileSync(join(boulderDirectory, "boulder.json"), JSON.stringify(state), "utf-8")
}

function createWork(input: {
  readonly workId: string
  readonly sessionIds: readonly string[]
  readonly startedAt: string
  readonly updatedAt?: string
}): BoulderWorkState {
  return {
    work_id: input.workId,
    active_plan: `.omo/plans/${input.workId}.md`,
    plan_name: input.workId,
    status: "active",
    started_at: input.startedAt,
    ...(input.updatedAt !== undefined ? { updated_at: input.updatedAt } : {}),
    session_ids: [...input.sessionIds],
  }
}

function createStateWithTwoWorks(): BoulderState {
  return {
    schema_version: 2,
    active_work_id: "work-a",
    works: {
      "work-a": createWork({
        workId: "work-a",
        sessionIds: ["opencode:session-a"],
        startedAt: "2026-06-05T01:00:00.000Z",
        updatedAt: "2026-06-05T01:00:00.000Z",
      }),
      "work-b": createWork({
        workId: "work-b",
        sessionIds: ["opencode:session-b"],
        startedAt: "2026-06-05T02:00:00.000Z",
        updatedAt: "2026-06-05T02:00:00.000Z",
      }),
    },
    active_plan: ".omo/plans/work-a.md",
    plan_name: "work-a",
    status: "active",
    started_at: "2026-06-05T01:00:00.000Z",
    updated_at: "2026-06-05T01:00:00.000Z",
    session_ids: ["opencode:session-a"],
    session_origins: {},
    task_sessions: {},
  }
}

describe("setBoulderPause / clearBoulderPause multi-work semantics", () => {
  test("#given work A active and pause targets work B session #when setting pause #then only B is paused and the top-level mirror is untouched", () => {
    // given
    const directory = createTempDirectory()
    writeState(directory, createStateWithTwoWorks())

    // when
    const result = setBoulderPause(directory, {
      reason: "final_wave_approval",
      sessionId: "opencode:session-b",
    })

    // then
    expect(result).not.toBeNull()
    const state = readBoulderState(directory)!
    expect(state.works?.["work-b"].pause?.reason).toBe("final_wave_approval")
    expect(state.works?.["work-b"].pause?.session_id).toBe("opencode:session-b")
    expect(state.works?.["work-a"].pause).toBeUndefined()
    expect(state.pause).toBeUndefined()
  })

  test("#given pause set on non-active work B #when selecting B as active #then pause survives the mirror projection", () => {
    // given
    const directory = createTempDirectory()
    writeState(directory, createStateWithTwoWorks())
    setBoulderPause(directory, {
      reason: "final_wave_approval",
      sessionId: "opencode:session-b",
    })

    // when
    selectActiveWork(directory, "work-b")

    // then
    const state = readBoulderState(directory)!
    expect(state.works?.["work-b"].pause?.reason).toBe("final_wave_approval")
    expect(state.works?.["work-b"].pause?.session_id).toBe("opencode:session-b")
    expect(state.pause?.reason).toBe("final_wave_approval")
    expect(state.pause?.session_id).toBe("opencode:session-b")
  })

  test("#given pause set on non-active work B #when clearing via B session #then only B pause is cleared and A is untouched", () => {
    // given
    const directory = createTempDirectory()
    writeState(directory, createStateWithTwoWorks())
    setBoulderPause(directory, {
      reason: "final_wave_approval",
      sessionId: "opencode:session-b",
    })
    expect(readBoulderState(directory)?.works?.["work-b"].pause?.reason).toBe("final_wave_approval")

    // when
    clearBoulderPause(directory, {
      reason: "final_wave_approval",
      sessionId: "opencode:session-b",
    })

    // then
    const state = readBoulderState(directory)!
    expect(state.works?.["work-b"].pause).toBeUndefined()
    expect(state.works?.["work-a"].pause).toBeUndefined()
    expect(state.pause).toBeUndefined()
  })

  test("#given pause set on active work A #when clearing via A session #then pause is cleared and mirror is updated", () => {
    // given
    const directory = createTempDirectory()
    writeState(directory, createStateWithTwoWorks())
    setBoulderPause(directory, {
      reason: "final_wave_approval",
      sessionId: "opencode:session-a",
    })
    expect(readBoulderState(directory)?.pause?.reason).toBe("final_wave_approval")

    // when
    clearBoulderPause(directory, {
      reason: "final_wave_approval",
      sessionId: "opencode:session-a",
    })

    // then
    const state = readBoulderState(directory)!
    expect(state.works?.["work-a"].pause).toBeUndefined()
    expect(state.pause).toBeUndefined()
  })

  test("#given legacy single-work state with no works map #when setting pause #then pause lives on the top-level mirror", () => {
    // given
    const directory = createTempDirectory()
    writeState(directory, {
      schema_version: 2,
      active_plan: ".omo/plans/legacy.md",
      plan_name: "legacy",
      status: "active",
      started_at: "2026-06-05T01:00:00.000Z",
      updated_at: "2026-06-05T01:00:00.000Z",
      session_ids: ["opencode:legacy-session"],
      session_origins: { "opencode:legacy-session": "direct" },
      task_sessions: {},
    })

    // when
    setBoulderPause(directory, {
      reason: "final_wave_approval",
      sessionId: "opencode:legacy-session",
    })

    // then
    const state = readBoulderState(directory)!
    expect(state.pause?.reason).toBe("final_wave_approval")
    expect(state.pause?.session_id).toBe("opencode:legacy-session")
  })
})
