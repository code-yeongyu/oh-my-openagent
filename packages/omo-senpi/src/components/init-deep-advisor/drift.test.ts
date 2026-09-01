/// <reference types="bun-types" />

import { join } from "node:path"

import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"

import { COOLDOWN_DAYS } from "./constants"
import { computeDrift, shouldProposeRefresh, type DriftMetrics } from "./drift"
import {
  advanceCommits,
  cleanupTempDirs,
  commitAll,
  git,
  initRepo,
  sourceFile,
  writeFileAt,
} from "./fixtures.test-support"
import type { InitDeepSnapshotV1 } from "./state"

afterEach(() => {
  cleanupTempDirs()
})

const MS_PER_DAY = 86_400_000

setDefaultTimeout(process.platform === "win32" ? 30_000 : 20_000)

function snapshotAt(commitSha: string, timestamp: number = Date.now()): InitDeepSnapshotV1 {
  return { commitSha, fileCount: 10, loc: 1000, timestamp, mode: "local" }
}

function makeDriftRepo(): { root: string; baseSha: string } {
  const root = initRepo("omo-drift-")
  for (let index = 0; index < 10; index++) {
    writeFileAt(root, join("src", `file${index}.ts`), sourceFile(100))
  }
  const baseSha = commitAll(root, "init")
  return { root, baseSha }
}

function thresholdDrift(): Extract<DriftMetrics, { kind: "valid" }> {
  return {
    kind: "valid",
    commitsSince: 40,
    touchedFiles: 2,
    trackedFiles: 10,
    touchedRatio: 0.2,
    churnLoc: 100,
    totalLoc: 1_000,
    churnLocRatio: 0.1,
    daysSince: 0,
  }
}

describe("computeDrift", () => {
  test("#given 40 commits touching 2 of 10 files #when computing drift #then metrics report 40 commits and a 0.2 touched ratio", () => {
    // given
    const { root, baseSha } = makeDriftRepo()
    advanceCommits(root, baseSha, 40, [0, 1])

    // when
    const drift = computeDrift(root, snapshotAt(baseSha))

    // then
    expect(drift.kind).toBe("valid")
    if (drift.kind !== "valid") return
    expect(drift.commitsSince).toBe(40)
    expect(drift.touchedFiles).toBe(2)
    expect(drift.trackedFiles).toBe(10)
    expect(drift.touchedRatio).toBeCloseTo(0.2, 10)
    expect(drift.churnLoc).toBeGreaterThan(0)
    expect(drift.totalLoc).toBeGreaterThan(0)
    expect(drift.churnLocRatio).toBeLessThan(0.25)
    expect(drift.daysSince).toBeLessThan(1)
  })

  test("#given an unchanged repo #when computing drift #then commits and churn are zero", () => {
    // given
    const { root, baseSha } = makeDriftRepo()

    // when
    const drift = computeDrift(root, snapshotAt(baseSha))

    // then
    expect(drift.kind).toBe("valid")
    if (drift.kind !== "valid") return
    expect(drift.commitsSince).toBe(0)
    expect(drift.touchedFiles).toBe(0)
    expect(drift.churnLoc).toBe(0)
  })

  test("#given an old snapshot timestamp #when computing drift #then daysSince reflects the age", () => {
    // given
    const { root, baseSha } = makeDriftRepo()
    const oldTimestamp = Date.now() - 100 * MS_PER_DAY

    // when
    const drift = computeDrift(root, snapshotAt(baseSha, oldTimestamp))

    // then
    expect(drift.kind).toBe("valid")
    if (drift.kind !== "valid") return
    expect(drift.daysSince).toBeGreaterThanOrEqual(100)
  })

  test("#given an invalid snapshot sha #when computing drift #then it is stale", () => {
    // given
    const { root } = makeDriftRepo()

    // when
    const drift = computeDrift(root, snapshotAt("0".repeat(40)))

    // then
    expect(drift).toEqual({ kind: "stale", stale: true })
  })

  test("#given a tag object sha #when computing drift #then it is stale", () => {
    // given
    const { root } = makeDriftRepo()
    git(root, ["tag", "-a", "v1", "-m", "tagged"])
    const tagSha = git(root, ["rev-parse", "v1"]).trim()

    // when
    const drift = computeDrift(root, snapshotAt(tagSha))

    // then
    expect(drift).toEqual({ kind: "stale", stale: true })
  })

  test("#given a tree object sha #when computing drift #then it is stale", () => {
    // given
    const { root } = makeDriftRepo()
    const treeSha = git(root, ["rev-parse", "HEAD^{tree}"]).trim()

    // when
    const drift = computeDrift(root, snapshotAt(treeSha))

    // then
    expect(drift).toEqual({ kind: "stale", stale: true })
  })

  test("#given a blob object sha #when computing drift #then it is stale", () => {
    // given
    const { root } = makeDriftRepo()
    const blobSha = git(root, ["rev-parse", "HEAD:src/file0.ts"]).trim()

    // when
    const drift = computeDrift(root, snapshotAt(blobSha))

    // then
    expect(drift).toEqual({ kind: "stale", stale: true })
  })
})

describe("shouldProposeRefresh", () => {
  test("#given 40 commits and a 20% touched ratio #when deciding #then it proposes a refresh", () => {
    // given
    const drift = thresholdDrift()

    // when
    const result = shouldProposeRefresh(drift, "current-head", null, 0)

    // then
    expect(result).toBe(true)
  })

  test("#given the current HEAD equals the last proposed HEAD #when deciding #then it suppresses", () => {
    // given
    const drift = thresholdDrift()
    const head = "current-head"

    // when
    const result = shouldProposeRefresh(drift, head, head, 0)

    // then
    expect(result).toBe(false)
  })

  test("#given an active 7-day cooldown #when deciding #then it suppresses", () => {
    // given
    const drift = thresholdDrift()
    const cooldownUntil = Date.now() + COOLDOWN_DAYS * MS_PER_DAY

    // when
    const result = shouldProposeRefresh(drift, "current-head", null, cooldownUntil)

    // then
    expect(result).toBe(false)
  })

  test("#given a stale drift result #when deciding #then it proposes a refresh", () => {
    // given
    const drift = { kind: "stale", stale: true } as const

    // when
    const result = shouldProposeRefresh(drift, "headsha", null, 0)

    // then
    expect(result).toBe(true)
  })

  test("#given a stale drift result inside the cooldown #when deciding #then the cooldown still suppresses", () => {
    // given
    const drift = { kind: "stale", stale: true } as const

    // when
    const result = shouldProposeRefresh(drift, "headsha", null, Date.now() + MS_PER_DAY)

    // then
    expect(result).toBe(false)
  })

  test("#given 40 commits but only a 5% touched ratio #when deciding #then the composite threshold suppresses", () => {
    // given
    const drift = {
      kind: "valid",
      commitsSince: 40,
      touchedFiles: 5,
      trackedFiles: 100,
      touchedRatio: 0.05,
      churnLoc: 10,
      totalLoc: 10_000,
      churnLocRatio: 0.001,
      daysSince: 1,
    } as const

    // when
    const result = shouldProposeRefresh(drift, "headsha", null, 0)

    // then
    expect(result).toBe(false)
  })

  test("#given a churn ratio at 0.25 #when deciding #then it proposes on the LOC lane alone", () => {
    // given
    const drift = {
      kind: "valid",
      commitsSince: 1,
      touchedFiles: 1,
      trackedFiles: 100,
      touchedRatio: 0.01,
      churnLoc: 2_500,
      totalLoc: 10_000,
      churnLocRatio: 0.25,
      daysSince: 1,
    } as const

    // when
    const result = shouldProposeRefresh(drift, "headsha", null, 0)

    // then
    expect(result).toBe(true)
  })

  test("#given a 90-day-old snapshot with no churn #when deciding #then it proposes on the age lane alone", () => {
    // given
    const drift = {
      kind: "valid",
      commitsSince: 0,
      touchedFiles: 0,
      trackedFiles: 100,
      touchedRatio: 0,
      churnLoc: 0,
      totalLoc: 10_000,
      churnLocRatio: 0,
      daysSince: 90,
    } as const

    // when
    const result = shouldProposeRefresh(drift, "headsha", null, 0)

    // then
    expect(result).toBe(true)
  })
})
