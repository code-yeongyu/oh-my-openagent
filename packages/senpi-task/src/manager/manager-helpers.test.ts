import { describe, expect, test } from "bun:test"

import type { TaskRecord } from "../state"
import { buildManagedSpec } from "./manager-helpers"
import type { ManagerStartSpec, ResolvedChildPlan } from "./types"

function record(): TaskRecord {
  return {
    task_id: "st_00000001",
    name: "st_00000001",
    parent_session_id: "parent-1",
    root_session_id: "parent-1",
    depth: 1,
    execution_mode: "in-process",
    model: "openai/gpt-5.6-sol",
    status: "pending",
    residency_state: "resident",
    created_at: "2026-07-23T00:00:00.000Z",
    updated_at: "2026-07-23T00:00:00.000Z",
    notification: { run_epoch: 0, notified_epoch: -1 },
  }
}

function spec(): ManagerStartSpec {
  return {
    prompt: "do the work",
    parent_session_id: "parent-1",
    depth: 1,
  }
}

function plan(overrides: Partial<ResolvedChildPlan> = {}): ResolvedChildPlan {
  return { model: "openai/gpt-5.6-sol", ...overrides }
}

describe("buildManagedSpec variant", () => {
  test("#given a plan carrying a resolved variant #when the managed spec is built #then the variant is threaded", () => {
    // given / when
    const managed = buildManagedSpec({
      record: record(),
      spec: spec(),
      plan: plan({ variant: "xhigh" }),
      cwd: "/tmp/project",
      stateDir: "/tmp/project/.omo/senpi-task",
    })

    // then
    expect(managed.variant).toBe("xhigh")
  })

  test("#given a plan without a variant #when the managed spec is built #then no variant is threaded", () => {
    // given / when
    const managed = buildManagedSpec({
      record: record(),
      spec: spec(),
      plan: plan(),
      cwd: "/tmp/project",
      stateDir: "/tmp/project/.omo/senpi-task",
    })

    // then
    expect(managed.variant).toBeUndefined()
  })
})
