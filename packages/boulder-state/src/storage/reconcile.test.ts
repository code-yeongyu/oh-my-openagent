/// <reference path="../../../../bun-test.d.ts" />

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"

import type { BoulderState, BoulderWorkState } from "../types"
import { readBoulderState } from "./read-state"
import { reconcileStaleBoulderWorks, resumeBoulderWork } from "./reconcile"

function createTempDirectory(): string {
  return mkdtempSync(join(tmpdir(), "boulder-reconcile-"))
}

function writeState(directory: string, state: BoulderState): void {
  const boulderDirectory = join(directory, ".omo")
  mkdirSync(boulderDirectory, { recursive: true })
  writeFileSync(join(boulderDirectory, "boulder.json"), JSON.stringify(state), "utf-8")
}

function createWork(input: {
  readonly workId: string
  readonly sessionIds?: readonly string[]
  readonly startedAt: string
  readonly updatedAt?: string
  readonly status?: "active" | "completed" | "paused" | "abandoned"
}): BoulderWorkState {
  return {
    work_id: input.workId,
    active_plan: `.omo/plans/${input.workId}.md`,
    plan_name: input.workId,
    status: input.status ?? "active",
    started_at: input.startedAt,
    ...(input.updatedAt !== undefined ? { updated_at: input.updatedAt } : {}),
    session_ids: [...(input.sessionIds ?? [])],
  }
}

function createState(works: readonly BoulderWorkState[]): BoulderState {
  const firstWork = works[0]
  return {
    schema_version: 2,
    active_work_id: firstWork?.work_id,
    works: Object.fromEntries(works.map((w) => [w.work_id, w])),
    active_plan: firstWork?.active_plan ?? "",
    plan_name: firstWork?.plan_name ?? "",
    started_at: firstWork?.started_at ?? "",
    session_ids: firstWork ? [...firstWork.session_ids] : [],
  }
}

describe("reconcileStaleBoulderWorks", () => {
  test("demotes a stale active work to paused", () => {
    const dir = createTempDirectory()
    const fourHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString()
    const work = createWork({
      workId: "stale-work",
      startedAt: fourHoursAgo,
      updatedAt: fourHoursAgo,
    })
    writeState(dir, createState([work]))

    const result = reconcileStaleBoulderWorks(dir)

    expect(result).not.toBeNull()
    const reconciled = readBoulderState(dir)
    const reconciledWork = reconciled?.works?.["stale-work"]
    expect(reconciledWork?.status).toBe("paused")
    expect(reconciledWork?.updated_at).not.toBe(fourHoursAgo)
  })

  test("keeps a fresh active work as active", () => {
    const dir = createTempDirectory()
    const work = createWork({
      workId: "fresh-work",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    writeState(dir, createState([work]))

    const result = reconcileStaleBoulderWorks(dir)

    expect(result).not.toBeNull()
    const reconciled = readBoulderState(dir)
    const reconciledWork = reconciled?.works?.["fresh-work"]
    expect(reconciledWork?.status).toBe("active")
  })

  test("does not touch completed or abandoned works", () => {
    const dir = createTempDirectory()
    const oldTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const completedWork = createWork({
      workId: "completed-work",
      startedAt: oldTime,
      updatedAt: oldTime,
      status: "completed",
    })
    const abandonedWork = createWork({
      workId: "abandoned-work",
      startedAt: oldTime,
      updatedAt: oldTime,
      status: "abandoned",
    })
    writeState(dir, createState([completedWork, abandonedWork]))

    reconcileStaleBoulderWorks(dir)

    const reconciled = readBoulderState(dir)
    expect(reconciled?.works?.["completed-work"]?.status).toBe("completed")
    expect(reconciled?.works?.["abandoned-work"]?.status).toBe("abandoned")
  })

  test("respects custom stale threshold", () => {
    const dir = createTempDirectory()
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    const work = createWork({
      workId: "recent-work",
      startedAt: thirtyMinAgo,
      updatedAt: thirtyMinAgo,
    })
    writeState(dir, createState([work]))

    // With a 1-hour threshold, 30 minutes is still fresh
    reconcileStaleBoulderWorks(dir, { staleThresholdMs: 60 * 60 * 1000 })
    let reconciled = readBoulderState(dir)
    expect(reconciled?.works?.["recent-work"]?.status).toBe("active")

    // With a 15-minute threshold, 30 minutes is stale
    reconcileStaleBoulderWorks(dir, { staleThresholdMs: 15 * 60 * 1000 })
    reconciled = readBoulderState(dir)
    expect(reconciled?.works?.["recent-work"]?.status).toBe("paused")
  })

  test("returns null when no state exists", () => {
    const dir = createTempDirectory()
    const result = reconcileStaleBoulderWorks(dir)
    expect(result).toBeNull()
  })

  test("uses session transcript mtime when available", () => {
    const dir = createTempDirectory()
    const oldTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const work = createWork({
      workId: "session-work",
      sessionIds: ["senpi:test-session"],
      startedAt: oldTime,
      updatedAt: oldTime,
    })
    writeState(dir, createState([work]))

    // Create a mock session directory with a fresh mtime
    const sessionDir = join(dir, "sessions", "test-session")
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(join(sessionDir, "transcript.jsonl"), "{}", "utf-8")

    const result = reconcileStaleBoulderWorks(dir, {
      resolveSessionDir: (id) => {
        if (id === "senpi:test-session") return sessionDir
        return undefined
      },
    })

    // Session transcript is fresh, so work stays active despite old updated_at
    const reconciled = readBoulderState(dir)
    expect(reconciled?.works?.["session-work"]?.status).toBe("active")
  })

  test("handles multiple works independently", () => {
    const dir = createTempDirectory()
    const oldTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const freshTime = new Date().toISOString()
    const staleWork = createWork({
      workId: "stale-one",
      startedAt: oldTime,
      updatedAt: oldTime,
    })
    const freshWork = createWork({
      workId: "fresh-one",
      startedAt: freshTime,
      updatedAt: freshTime,
    })
    writeState(dir, createState([staleWork, freshWork]))

    reconcileStaleBoulderWorks(dir)

    const reconciled = readBoulderState(dir)
    expect(reconciled?.works?.["stale-one"]?.status).toBe("paused")
    expect(reconciled?.works?.["fresh-one"]?.status).toBe("active")
  })
})

describe("resumeBoulderWork", () => {
  test("resumes a paused work back to active", () => {
    const dir = createTempDirectory()
    const work = createWork({
      workId: "paused-work",
      startedAt: new Date().toISOString(),
      status: "paused",
    })
    writeState(dir, createState([work]))

    const result = resumeBoulderWork(dir, "paused-work")

    expect(result).not.toBeNull()
    const state = readBoulderState(dir)
    expect(state?.works?.["paused-work"]?.status).toBe("active")
  })

  test("returns null for non-existent work", () => {
    const dir = createTempDirectory()
    const work = createWork({
      workId: "existing-work",
      startedAt: new Date().toISOString(),
    })
    writeState(dir, createState([work]))

    const result = resumeBoulderWork(dir, "non-existent")
    expect(result).toBeNull()
  })
})
