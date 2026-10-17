import { describe, expect, test } from "bun:test"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { getDailyActiveCaptureState, getTelemetryActivityStateFilePath } from "./index"

const DAY_UTC = "2026-05-25"

function createStateDir(): string {
  return mkdtempSync(join(tmpdir(), "telemetry-core-dedupe-"))
}

/** The claim filename is the cross-process contract, so it is pinned literally. */
function dayClaimPath(stateDir: string, dayUTC: string): string {
  return join(stateDir, `daily-active.${dayUTC}.claim`)
}

/**
 * A state dir that can never be created: its parent is a regular file, so directory creation fails
 * on every platform. Stands in for any machine where the day stamp cannot be persisted at all.
 */
function createUnwritableStateDir(): { readonly stateDir: string; readonly cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "telemetry-core-blocked-"))
  const blocker = join(root, "blocker")
  writeFileSync(blocker, "not a directory\n")
  return {
    stateDir: join(blocker, "state"),
    cleanup: () => {
      rmSync(root, { recursive: true, force: true })
    },
  }
}

describe("daily-active dedup under failure and concurrency", () => {
  test("#given a fresh day #when evaluated #then it captures and leaves a claim a peer would lose against", () => {
    // given
    const stateDir = createStateDir()

    try {
      // when
      const result = getDailyActiveCaptureState({
        stateDir,
        now: new Date(`${DAY_UTC}T01:02:03.000Z`),
      })

      // then
      expect(result).toEqual({ dayUTC: DAY_UTC, captureDaily: true })
      expect(readdirSync(stateDir)).toContain(`daily-active.${DAY_UTC}.claim`)
    } finally {
      rmSync(stateDir, { recursive: true, force: true })
    }
  })

  test("#given another process already claimed today #when evaluated #then it does not capture", () => {
    // given - the peer holds the claim and has not written the advisory state file yet
    const stateDir = createStateDir()
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(dayClaimPath(stateDir, DAY_UTC), "")

    try {
      // when
      const result = getDailyActiveCaptureState({
        stateDir,
        now: new Date(`${DAY_UTC}T01:02:03.000Z`),
      })

      // then
      expect(result).toEqual({ dayUTC: DAY_UTC, captureDaily: false })
    } finally {
      rmSync(stateDir, { recursive: true, force: true })
    }
  })

  test("#given yesterday's claim #when evaluated today #then it captures and prunes the stale claim", () => {
    // given
    const stateDir = createStateDir()
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(dayClaimPath(stateDir, "2026-05-24"), "")

    try {
      // when
      const result = getDailyActiveCaptureState({
        stateDir,
        now: new Date(`${DAY_UTC}T00:00:01.000Z`),
      })

      // then - claims must not accumulate one file per day forever
      expect(result.captureDaily).toBe(true)
      const entries = readdirSync(stateDir)
      expect(entries).toContain(`daily-active.${DAY_UTC}.claim`)
      expect(entries).not.toContain("daily-active.2026-05-24.claim")
    } finally {
      rmSync(stateDir, { recursive: true, force: true })
    }
  })

  test("#given the stamp cannot be persisted #when evaluated repeatedly in one process #then it captures at most once", () => {
    // given
    const { stateDir, cleanup } = createUnwritableStateDir()

    try {
      // when
      const first = getDailyActiveCaptureState({
        stateDir,
        now: new Date(`${DAY_UTC}T01:02:03.000Z`),
      })
      const second = getDailyActiveCaptureState({
        stateDir,
        now: new Date(`${DAY_UTC}T01:02:04.000Z`),
      })
      const third = getDailyActiveCaptureState({
        stateDir,
        now: new Date(`${DAY_UTC}T20:00:00.000Z`),
      })

      // then - a machine that cannot persist is bounded to one event per process, never one per launch
      expect(first.captureDaily).toBe(true)
      expect(second.captureDaily).toBe(false)
      expect(third.captureDaily).toBe(false)
    } finally {
      cleanup()
    }
  })

  test("#given a corrupt state file #when evaluated #then it captures once and repairs the state", () => {
    // given
    const stateDir = createStateDir()
    const stateFilePath = getTelemetryActivityStateFilePath(stateDir)
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(stateFilePath, "{bad-json\n")

    try {
      // when
      const result = getDailyActiveCaptureState({
        stateDir,
        now: new Date(`${DAY_UTC}T10:00:00.000Z`),
      })

      // then - the next process reads a healthy state instead of capturing again
      expect(result.captureDaily).toBe(true)
      expect(readdirSync(stateDir)).toContain(`daily-active.${DAY_UTC}.claim`)
      expect(readFileSync(stateFilePath, "utf-8")).toBe(
        `{\n  "lastActiveDayUTC": "${DAY_UTC}"\n}\n`,
      )
    } finally {
      rmSync(stateDir, { recursive: true, force: true })
    }
  })

  test("#given state already stamped for today #when evaluated #then it reports false without touching the dir", () => {
    // given - the common path: every launch after the first one of the day
    const stateDir = createStateDir()
    const stateFilePath = getTelemetryActivityStateFilePath(stateDir)
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(stateFilePath, `{"lastActiveDayUTC":"${DAY_UTC}"}\n`)
    const entriesBefore = readdirSync(stateDir).sort()
    const mtimeBefore = statSync(stateFilePath).mtimeMs

    try {
      // when
      const result = getDailyActiveCaptureState({
        stateDir,
        now: new Date(`${DAY_UTC}T12:00:00.000Z`),
      })

      // then - no writes at all on the hot path, and an upgraded client honours the old stamp
      expect(result).toEqual({ dayUTC: DAY_UTC, captureDaily: false })
      expect(readdirSync(stateDir).sort()).toEqual(entriesBefore)
      expect(statSync(stateFilePath).mtimeMs).toBe(mtimeBefore)
    } finally {
      rmSync(stateDir, { recursive: true, force: true })
    }
  })
})
