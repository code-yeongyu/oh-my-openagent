/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import type { Task } from "../types"
import { canClaim } from "./dependencies"

function buildTask(id: string, status: Task["status"], blockedBy: string[] = []): Task {
  const now = Date.now()
  return {
    version: 1,
    id,
    subject: `subject-${id}`,
    description: `description-${id}`,
    status,
    blocks: [],
    blockedBy,
    createdAt: now,
    updatedAt: now,
  }
}

describe("canClaim", () => {
  test("returns false when a blocker is not completed", () => {
    // given
    const blockerTask = buildTask("2", "in_progress")
    const dependentTask = buildTask("1", "pending", ["2"])

    // when
    const claimable = canClaim(dependentTask, [dependentTask, blockerTask])

    // then
    expect(claimable).toBe(false)
  })

  test("ignores missing blockers and completed blockers", () => {
    // given
    const completedBlockerTask = buildTask("2", "completed")
    const dependentTask = buildTask("1", "pending", ["2", "999"])

    // when
    const claimable = canClaim(dependentTask, [dependentTask, completedBlockerTask])

    // then
    expect(claimable).toBe(true)
  })
})
