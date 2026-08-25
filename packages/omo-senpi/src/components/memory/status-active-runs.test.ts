import { describe, expect, test } from "bun:test"

import { createActiveReflectionRuns, type ActiveReflectionRunDetails } from "./status-active-runs"

const details: ActiveReflectionRunDetails = {
  trigger: "step_count",
  category: "quick",
  startedAt: "2026-08-12T00:00:00.000Z",
}

describe("active reflection runs", () => {
  test("#given no launches #when activity is queried #then the identity is idle", () => {
    const runs = createActiveReflectionRuns()

    expect(runs.isActive("agent-test")).toBe(false)
  })

  test("#given a launched run #when activity is queried #then the identity is active", () => {
    const runs = createActiveReflectionRuns()

    runs.start("agent-test", "run-1", details)

    expect(runs.isActive("agent-test")).toBe(true)
  })

  test("#given a launched run #when the run settles #then the identity returns to idle", () => {
    const runs = createActiveReflectionRuns()

    runs.start("agent-test", "run-1", details)
    runs.settle("agent-test", "run-1")

    expect(runs.isActive("agent-test")).toBe(false)
  })

  test("#given two concurrent runs #when only one settles #then the identity stays active", () => {
    const runs = createActiveReflectionRuns()

    runs.start("agent-test", "run-1", details)
    runs.start("agent-test", "run-2", details)
    runs.settle("agent-test", "run-1")

    expect(runs.isActive("agent-test")).toBe(true)

    runs.settle("agent-test", "run-2")
    expect(runs.isActive("agent-test")).toBe(false)
  })

  test("#given runs on separate identities #when one settles #then the other is unaffected", () => {
    const runs = createActiveReflectionRuns()

    runs.start("agent-a", "run-1", details)
    runs.start("agent-b", "run-2", details)
    runs.settle("agent-a", "run-1")

    expect(runs.isActive("agent-a")).toBe(false)
    expect(runs.isActive("agent-b")).toBe(true)
  })

  test("#given a duplicate launch of the same run id #when it settles once #then the identity is idle", () => {
    const runs = createActiveReflectionRuns()

    runs.start("agent-test", "run-1", details)
    runs.start("agent-test", "run-1", details)
    runs.settle("agent-test", "run-1")

    expect(runs.isActive("agent-test")).toBe(false)
  })

  test("#given an unknown run id #when it settles #then no active state is invented", () => {
    const runs = createActiveReflectionRuns()

    runs.settle("agent-test", "ghost-run")

    expect(runs.isActive("agent-test")).toBe(false)
  })

  test("#given a launched run #when the current run is queried #then its launch facts are returned", () => {
    const runs = createActiveReflectionRuns()

    runs.start("agent-test", "run-1", details)

    expect(runs.current("agent-test")).toEqual({ runId: "run-1", ...details })
  })

  test("#given no launched run #when the current run is queried #then nothing is reported", () => {
    const runs = createActiveReflectionRuns()

    runs.start("agent-test", "run-1", details)
    runs.settle("agent-test", "run-1")

    expect(runs.current("agent-test")).toBeUndefined()
  })

  test("#given active runs #when the identity is cleared for shutdown #then it reports idle", () => {
    const runs = createActiveReflectionRuns()

    runs.start("agent-test", "run-1", details)
    runs.start("agent-test", "run-2", details)
    runs.clear("agent-test")

    expect(runs.isActive("agent-test")).toBe(false)
  })
})
