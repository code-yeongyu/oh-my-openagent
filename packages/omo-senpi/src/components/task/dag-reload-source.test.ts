import { describe, expect, it } from "bun:test"

import { createDagReloadSource, type DagReloadRunManager } from "./dag-reload-source"

const SESSION_ID = "parent-session"

function managerOf(
  runs: ReadonlyArray<{ readonly runId: string; readonly status: string; readonly name?: string }>,
  options: { readonly snapshotThrowsFor?: string } = {},
): DagReloadRunManager {
  return {
    list: (parentSessionId) =>
      parentSessionId === SESSION_ID ? runs.map(({ runId, status }) => ({ runId, status })) : [],
    snapshot: (runId) => {
      if (runId === options.snapshotThrowsFor) throw new Error("pruned")
      return { name: runs.find((entry) => entry.runId === runId)?.name ?? runId }
    },
  }
}

describe("dag reload source", () => {
  it("#given a running and a paused run #when live runs are read #then both are reported with their names", () => {
    const source = createDagReloadSource({
      manager: managerOf([
        { runId: "dag_1", status: "running", name: "mass-ulw" },
        { runId: "dag_2", status: "paused", name: "release" },
      ]),
      sessionId: () => SESSION_ID,
    })

    expect(source.liveRuns()).toEqual([
      { runId: "dag_1", name: "mass-ulw", status: "running" },
      { runId: "dag_2", name: "release", status: "paused" },
    ])
  })

  it("#given only terminal runs #when live runs are read #then nothing is live", () => {
    const source = createDagReloadSource({
      manager: managerOf([
        { runId: "dag_1", status: "completed" },
        { runId: "dag_2", status: "failed" },
        { runId: "dag_3", status: "cancelled" },
      ]),
      sessionId: () => SESSION_ID,
    })

    expect(source.liveRuns()).toEqual([])
  })

  it("#given no session id #when live runs are read #then it fails open with nothing live", () => {
    const source = createDagReloadSource({
      manager: managerOf([{ runId: "dag_1", status: "running", name: "mass-ulw" }]),
      sessionId: () => undefined,
    })

    expect(source.liveRuns()).toEqual([])
  })

  it("#given a run pruned between list and snapshot #when live runs are read #then it falls back to the run id", () => {
    const source = createDagReloadSource({
      manager: managerOf([{ runId: "dag_1", status: "running", name: "mass-ulw" }], {
        snapshotThrowsFor: "dag_1",
      }),
      sessionId: () => SESSION_ID,
    })

    expect(source.liveRuns()).toEqual([{ runId: "dag_1", name: "dag_1", status: "running" }])
  })
})
