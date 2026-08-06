import { describe, expect, it } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { LOOP_FRESH_MS } from "./constants"
import { readActiveLoop } from "./loop-reader"

function withProject(run: (projectDir: string) => void): void {
  const projectDir = mkdtempSync(join(tmpdir(), "omo-loop-reader-"))
  try {
    run(projectDir)
  } finally {
    rmSync(projectDir, { force: true, recursive: true })
  }
}

function writeGoalFile(projectDir: string, relativePath: string, payload: unknown): string {
  const filePath = join(projectDir, relativePath)
  mkdirSync(join(filePath, ".."), { recursive: true })
  writeFileSync(filePath, JSON.stringify(payload))
  return filePath
}

function makeStale(filePath: string): void {
  const staleDate = new Date(Date.now() - LOOP_FRESH_MS - 5_000)
  utimesSync(filePath, staleDate, staleDate)
}

describe("readActiveLoop", () => {
  it("#given a live current-schema loop #when read #then it computes goal and criterion counts", () => {
    withProject((projectDir) => {
      // given
      writeGoalFile(projectDir, ".omo/ulw-loop/current/goals.json", {
        version: 1,
        activeGoalId: "ship",
        goals: [
          {
            id: "setup",
            title: "Set up sidebar",
            status: "complete",
            successCriteria: [{ status: "pass" }, { status: "fail" }],
          },
          {
            id: "ship",
            title: "Ship loop reader",
            status: "in_progress",
            successCriteria: [{ status: "pass" }, { status: "blocked" }, { status: "mystery" }],
          },
        ],
      })

      // when
      const loop = readActiveLoop(projectDir)

      // then
      expect(loop).toEqual({
        kind: "live",
        goalsDone: 1,
        goalsTotal: 2,
        pass: 2,
        fail: 1,
        pending: 1,
        blocked: 1,
        activeGoal: "Ship loop reader",
      })
    })
  })

  it("#given a live legacy loop #when read #then it reads criteria arrays", () => {
    withProject((projectDir) => {
      // given
      writeGoalFile(projectDir, ".omo/loop/goals.json", {
        goals: [
          {
            id: "legacy-active",
            title: "Legacy active goal",
            status: "in_progress",
            criteria: [{ status: "pass" }, { status: "fail" }, { status: "pending" }, { status: "blocked" }],
          },
        ],
      })

      // when
      const loop = readActiveLoop(projectDir)
      // then
      expect(loop).toEqual({
        kind: "live",
        goalsDone: 0,
        goalsTotal: 1,
        pass: 1,
        fail: 1,
        pending: 1,
        blocked: 1,
        activeGoal: "Legacy active goal",
      })
    })
  })

  it("#given only stale loops #when read #then it returns none", () => {
    withProject((projectDir) => {
      // given
      const filePath = writeGoalFile(projectDir, ".omo/ulw-loop/stale/goals.json", {
        version: 1,
        goals: [
          {
            id: "old",
            title: "Old goal",
            status: "in_progress",
            successCriteria: [{ status: "pass" }],
          },
        ],
      })
      makeStale(filePath)

      // when
      const loop = readActiveLoop(projectDir)
      // then
      expect(loop).toEqual({ kind: "none" })
    })
  })

  it("#given two live current loop dirs #when read #then it chooses the freshest mtime", () => {
    withProject((projectDir) => {
      // given
      writeGoalFile(projectDir, ".omo/ulw-loop/older/goals.json", {
        version: 1,
        goals: [
          {
            id: "older",
            title: "Older live goal",
            status: "in_progress",
            successCriteria: [{ status: "fail" }],
          },
        ],
      })
      const fresherPath = writeGoalFile(projectDir, ".omo/ulw-loop/newer/goals.json", {
        version: 1,
        goals: [
          {
            id: "newer",
            title: "Newer live goal",
            status: "in_progress",
            successCriteria: [{ status: "pass" }, { status: "pass" }],
          },
        ],
      })
      const futureDate = new Date(Date.now() + 1_000)
      utimesSync(fresherPath, futureDate, futureDate)

      // when
      const loop = readActiveLoop(projectDir)
      // then
      expect(loop).toMatchObject({
        kind: "live",
        pass: 2,
        fail: 0,
        activeGoal: "Newer live goal",
      })
    })
  })

  it("#given malformed JSON beside a valid live loop #when read #then it skips malformed input", () => {
    withProject((projectDir) => {
      // given
      const malformedPath = join(projectDir, ".omo/ulw-loop/bad/goals.json")
      mkdirSync(join(malformedPath, ".."), { recursive: true })
      writeFileSync(malformedPath, "{")
      writeGoalFile(projectDir, ".omo/ulw-loop/good/goals.json", {
        version: 1,
        goals: [
          {
            id: "good",
            title: "Good live goal",
            status: "in_progress",
            successCriteria: [{ status: "pass" }],
          },
        ],
      })

      // when
      const loop = readActiveLoop(projectDir)
      // then
      expect(loop).toMatchObject({ kind: "live", activeGoal: "Good live goal" })
    })
  })

  it("#given active goal variants #when read #then activeGoal follows id, in-progress, null fallback order", () => {
    withProject((projectDir) => {
      // given
      writeGoalFile(projectDir, ".omo/ulw-loop/by-id/goals.json", {
        version: 1,
        activeGoalId: "chosen",
        goals: [
          { id: "first", title: "First in progress", status: "in_progress", successCriteria: [] },
          { id: "chosen", title: "Chosen by id", status: "in_progress", successCriteria: [] },
        ],
      })

      // when
      const loop = readActiveLoop(projectDir)

      // then
      expect(loop).toMatchObject({ kind: "live", activeGoal: "Chosen by id" })
    })

    withProject((projectDir) => {
      // given
      writeGoalFile(projectDir, ".omo/ulw-loop/by-progress/goals.json", {
        version: 1,
        goals: [
          { id: "done", title: "Done", status: "complete", successCriteria: [] },
          { id: "active", title: "First active", status: "in_progress", successCriteria: [] },
        ],
      })

      // when
      const loop = readActiveLoop(projectDir)

      // then
      expect(loop).toMatchObject({ kind: "live", activeGoal: "First active" })
    })

    withProject((projectDir) => {
      // given
      writeGoalFile(projectDir, ".omo/ulw-loop/not-live/goals.json", {
        version: 1,
        activeGoalId: "missing",
        goals: [
          { id: "blocked", title: "Blocked", status: "blocked", successCriteria: [] },
        ],
      })

      // when
      const loop = readActiveLoop(projectDir)

      // then
      expect(loop).toEqual({ kind: "none" })
    })
  })
})
