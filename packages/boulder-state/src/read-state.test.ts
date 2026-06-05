/// <reference path="../../../bun-test.d.ts" />

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"

import type { BoulderState, BoulderWorkState } from "./types"
import { getWorkForSession, readBoulderState } from "./storage/read-state"

function createTempDirectory(): string {
  return mkdtempSync(join(tmpdir(), "boulder-read-state-"))
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

function createState(works: readonly BoulderWorkState[]): BoulderState {
  const firstWork = works[0]
  if (!firstWork) {
    throw new Error("test state requires at least one work")
  }

  return {
    schema_version: 2,
    active_work_id: firstWork.work_id,
    works: Object.fromEntries(works.map((work) => [work.work_id, work])),
    active_plan: firstWork.active_plan,
    plan_name: firstWork.plan_name,
    status: firstWork.status,
    started_at: firstWork.started_at,
    updated_at: firstWork.updated_at,
    session_ids: [...firstWork.session_ids],
    session_origins: {},
    task_sessions: {},
  }
}

describe("readBoulderState", () => {
  test("#given no boulder file #when reading state #then null is returned", () => {
    // given
    const directory = createTempDirectory()

    // when
    const state = readBoulderState(directory)

    // then
    expect(state).toBeNull()
  })

  test("#given malformed state json #when reading state #then null is returned", () => {
    // given
    const directory = createTempDirectory()
    const boulderDirectory = join(directory, ".omo")
    mkdirSync(boulderDirectory, { recursive: true })
    writeFileSync(join(boulderDirectory, "boulder.json"), "{not-json", "utf-8")

    // when
    const state = readBoulderState(directory)

    // then
    expect(state).toBeNull()
  })

  test("#given non-object state json #when reading state #then null is returned", () => {
    // given
    const directory = createTempDirectory()
    const boulderDirectory = join(directory, ".omo")
    mkdirSync(boulderDirectory, { recursive: true })
    writeFileSync(join(boulderDirectory, "boulder.json"), "[]", "utf-8")

    // when
    const state = readBoulderState(directory)

    // then
    expect(state).toBeNull()
  })
})

describe("getWorkForSession", () => {
  test("#given multiple works for one session #when reading by session #then newest updated work is returned", () => {
    // given
    const directory = createTempDirectory()
    writeState(directory, createState([
      createWork({
        workId: "older",
        sessionIds: ["opencode:sess-a"],
        startedAt: "2026-06-05T01:00:00.000Z",
        updatedAt: "2026-06-05T02:00:00.000Z",
      }),
      createWork({
        workId: "newest",
        sessionIds: ["opencode:sess-a"],
        startedAt: "2026-06-05T01:30:00.000Z",
        updatedAt: "2026-06-05T03:00:00.000Z",
      }),
    ]))

    // when
    const work = getWorkForSession(directory, "sess-a")

    // then
    expect(work?.work_id).toBe("newest")
  })

  test("#given matching works without updated times #when reading by session #then newest started work is returned", () => {
    // given
    const directory = createTempDirectory()
    writeState(directory, createState([
      createWork({
        workId: "older-start",
        sessionIds: ["opencode:sess-a"],
        startedAt: "2026-06-05T01:00:00.000Z",
      }),
      createWork({
        workId: "newer-start",
        sessionIds: ["opencode:sess-a"],
        startedAt: "2026-06-05T02:00:00.000Z",
      }),
    ]))

    // when
    const work = getWorkForSession(directory, "opencode:sess-a")

    // then
    expect(work?.work_id).toBe("newer-start")
  })

  test("#given matching works with identical sort times #when reading by session #then first inserted work is returned", () => {
    // given
    const directory = createTempDirectory()
    writeState(directory, createState([
      createWork({
        workId: "first",
        sessionIds: ["opencode:sess-a"],
        startedAt: "2026-06-05T01:00:00.000Z",
        updatedAt: "2026-06-05T02:00:00.000Z",
      }),
      createWork({
        workId: "second",
        sessionIds: ["opencode:sess-a"],
        startedAt: "2026-06-05T01:30:00.000Z",
        updatedAt: "2026-06-05T02:00:00.000Z",
      }),
    ]))

    // when
    const work = getWorkForSession(directory, "sess-a")

    // then
    expect(work?.work_id).toBe("first")
  })

  test("#given matching works with invalid sort times #when reading by session #then first inserted work is returned", () => {
    // given
    const directory = createTempDirectory()
    writeState(directory, createState([
      createWork({
        workId: "first-invalid",
        sessionIds: ["opencode:sess-a"],
        startedAt: "not-a-date",
        updatedAt: "also-not-a-date",
      }),
      createWork({
        workId: "second-invalid",
        sessionIds: ["opencode:sess-a"],
        startedAt: "still-not-a-date",
        updatedAt: "nope",
      }),
    ]))

    // when
    const work = getWorkForSession(directory, "sess-a")

    // then
    expect(work?.work_id).toBe("first-invalid")
  })

  test("#given valid and invalid matching work times #when reading by session #then valid time wins", () => {
    // given
    const directory = createTempDirectory()
    writeState(directory, createState([
      createWork({
        workId: "invalid",
        sessionIds: ["opencode:sess-a"],
        startedAt: "not-a-date",
        updatedAt: "also-not-a-date",
      }),
      createWork({
        workId: "valid",
        sessionIds: ["opencode:sess-a"],
        startedAt: "2026-06-05T01:00:00.000Z",
        updatedAt: "2026-06-05T02:00:00.000Z",
      }),
    ]))

    // when
    const work = getWorkForSession(directory, "sess-a")

    // then
    expect(work?.work_id).toBe("valid")
  })

  test("#given no matching work but matching mirror session #when reading by session #then mirror work is returned", () => {
    // given
    const directory = createTempDirectory()
    writeState(directory, {
      schema_version: 2,
      active_plan: ".omo/plans/mirror.md",
      plan_name: "mirror",
      status: "active",
      started_at: "2026-06-05T01:00:00.000Z",
      session_ids: ["opencode:sess-a"],
      session_origins: { "opencode:sess-a": "direct" },
      task_sessions: {},
    })

    // when
    const work = getWorkForSession(directory, "sess-a")

    // then
    expect(work?.work_id).toBe("mirror-legacy")
  })
})
