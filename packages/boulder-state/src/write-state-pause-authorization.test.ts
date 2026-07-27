/// <reference path="../../../bun-test.d.ts" />

import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { BoulderState, BoulderWorkState } from "./types"
import { readBoulderState } from "./storage/read-state"
import { clearBoulderPause, setBoulderPause } from "./storage/write-state"

const OWNER_SESSION_ID = "opencode:owner-session"
const UNKNOWN_SESSION_ID = "opencode:unknown-session"

function createTempDirectory(): string {
  return mkdtempSync(join(tmpdir(), "boulder-pause-authorization-"))
}

function createWork(pauseOwner?: string): BoulderWorkState {
  return {
    work_id: "work-a",
    active_plan: ".omo/plans/work-a.md",
    plan_name: "work-a",
    status: "active",
    started_at: "2026-07-27T00:00:00.000Z",
    updated_at: "2026-07-27T00:00:00.000Z",
    session_ids: [OWNER_SESSION_ID],
    ...(pauseOwner ? {
      pause: {
        reason: "final_wave_approval",
        session_id: pauseOwner,
        created_at: "2026-07-27T00:00:00.000Z",
      },
    } : {}),
  }
}

function createState(pauseOwner?: string): BoulderState {
  const work = createWork(pauseOwner)
  return {
    schema_version: 2,
    active_work_id: work.work_id,
    works: { [work.work_id]: work },
    active_plan: work.active_plan,
    plan_name: work.plan_name,
    status: work.status,
    started_at: work.started_at,
    updated_at: work.updated_at,
    session_ids: [...work.session_ids],
    session_origins: {},
    task_sessions: {},
    ...(work.pause ? { pause: { ...work.pause } } : {}),
  }
}

function writeState(directory: string, state: BoulderState): void {
  const boulderDirectory = join(directory, ".omo")
  mkdirSync(boulderDirectory, { recursive: true })
  writeFileSync(join(boulderDirectory, "boulder.json"), JSON.stringify(state), "utf-8")
}

function readRequiredState(directory: string): BoulderState {
  const state = readBoulderState(directory)
  if (state === null) throw new Error("Expected persisted Boulder state")
  return state
}

describe("Boulder pause session authorization", () => {
  test("#given a tracked owner pause #when an unknown session sets a pause #then cannot replace the owner", () => {
    // given
    const directory = createTempDirectory()
    writeState(directory, createState(OWNER_SESSION_ID))

    // when
    setBoulderPause(directory, {
      reason: "final_wave_approval",
      sessionId: UNKNOWN_SESSION_ID,
    })

    // then
    const state = readRequiredState(directory)
    expect(state.pause?.session_id).toBe(OWNER_SESSION_ID)
    expect(state.works?.["work-a"].pause?.session_id).toBe(OWNER_SESSION_ID)
  })

  test("#given corrupted unknown ownership #when that unknown session clears #then cannot mutate a tracked work", () => {
    // given
    const directory = createTempDirectory()
    writeState(directory, createState(UNKNOWN_SESSION_ID))

    // when
    clearBoulderPause(directory, {
      reason: "final_wave_approval",
      sessionId: UNKNOWN_SESSION_ID,
    })

    // then
    const state = readRequiredState(directory)
    expect(state.pause?.session_id).toBe(UNKNOWN_SESSION_ID)
    expect(state.works?.["work-a"].pause?.session_id).toBe(UNKNOWN_SESSION_ID)
  })

  test("#given legacy single-work state #when its tracked owner sets and clears #then preserves legacy compatibility", () => {
    // given
    const directory = createTempDirectory()
    const legacy = createState()
    delete legacy.schema_version
    delete legacy.active_work_id
    delete legacy.works
    writeState(directory, legacy)

    // when
    setBoulderPause(directory, {
      reason: "final_wave_approval",
      sessionId: OWNER_SESSION_ID,
    })

    // then
    expect(readRequiredState(directory).pause?.session_id).toBe(OWNER_SESSION_ID)

    // when
    clearBoulderPause(directory, {
      reason: "final_wave_approval",
      sessionId: OWNER_SESSION_ID,
    })

    // then
    expect(readRequiredState(directory).pause).toBeUndefined()
  })
})
