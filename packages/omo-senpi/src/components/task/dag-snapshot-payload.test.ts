import { describe, expect, it } from "bun:test"

import { dagUpdatedPayload, type DagBridgeRunSnapshot } from "./dag-snapshot-payload"

type WireRun = {
  readonly run_id: string
  readonly status: string
  readonly completed_at?: string
  readonly amend_count?: number
  readonly lease_holder_pid?: number
  readonly nodes: readonly {
    readonly id: string
    readonly attempt: number
    readonly last_error?: { readonly code: string; readonly message: string }
  }[]
}

function payloadRuns(runs: readonly DagBridgeRunSnapshot[]): readonly WireRun[] {
  return (dagUpdatedPayload("ses_parent", runs) as { runs: readonly WireRun[] }).runs
}

// A run as the engine projects it: camelCase in, snake_case out on the wire.
function runSnapshot(overrides: Partial<DagBridgeRunSnapshot> = {}): DagBridgeRunSnapshot {
  return {
    runId: "dag_1",
    runKey: "key_dag_1",
    name: "run dag_1",
    status: "running",
    createdAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:01.000Z",
    counts: { total: 1, completed: 0, failed: 0, running: 1 },
    nodes: [
      {
        id: "build",
        prompt: "build it",
        dependsOn: [],
        state: "running",
        attempt: 1,
        createdAt: "2026-08-14T00:00:00.000Z",
      },
    ],
    edges: [],
    waves: [{ index: 0, nodeIds: ["build"] }],
    ...overrides,
  }
}

describe("dagUpdatedPayload", () => {
  describe("#given a node that failed and was retried", () => {
    it("#when the payload is built #then the node carries its attempt and last_error", () => {
      // given a node on its second attempt still holding the error the first attempt produced
      const run = runSnapshot({
        nodes: [
          {
            id: "build",
            prompt: "build it",
            dependsOn: [],
            state: "failed",
            attempt: 2,
            createdAt: "2026-08-14T00:00:00.000Z",
            error: { code: "task_error", message: "build exited 1" },
          },
        ],
      })

      // when
      const node = payloadRuns([run])[0]?.nodes[0]

      // then
      expect(node?.attempt).toBe(2)
      expect(node?.last_error).toEqual({ code: "task_error", message: "build exited 1" })
    })

    it("#when the node never failed #then last_error is absent rather than null", () => {
      // given / when
      const node = payloadRuns([runSnapshot()])[0]?.nodes[0]

      // then
      expect(node).not.toHaveProperty("last_error")
    })

    it("#when the engine error carries extra fields #then only code and message reach the wire", () => {
      // given the engine's DagNodeError also carries nodeId and at, which viewers never consume
      const run = runSnapshot({
        nodes: [
          {
            id: "build",
            prompt: "build it",
            dependsOn: [],
            state: "failed",
            attempt: 1,
            createdAt: "2026-08-14T00:00:00.000Z",
            error: { code: "task_cancelled", message: "cancelled", nodeId: "build", at: "2026-08-14T00:00:03.000Z" },
          },
        ],
      })

      // when
      const node = payloadRuns([run])[0]?.nodes[0]

      // then
      expect(node?.last_error).toEqual({ code: "task_cancelled", message: "cancelled" })
    })
  })

  describe("#given a run whose definition was amended", () => {
    it("#when the payload is built #then amend_count reports the amend history length", () => {
      // given two amendments recorded on the run
      const run = runSnapshot({
        amendHistory: [
          { at: "2026-08-14T00:01:00.000Z" },
          { at: "2026-08-14T00:02:00.000Z" },
        ],
      })

      // when
      const wireRun = payloadRuns([run])[0]

      // then
      expect(wireRun?.amend_count).toBe(2)
    })

    it("#when the run was never amended #then amend_count is absent", () => {
      // given / when
      const wireRun = payloadRuns([runSnapshot({ amendHistory: [] })])[0]

      // then
      expect(wireRun).not.toHaveProperty("amend_count")
      expect(payloadRuns([runSnapshot()])[0]).not.toHaveProperty("amend_count")
    })
  })

  describe("#given a settled run that resumed after a retry", () => {
    it("#when the payload is built #then completed_at is absent for the running run", () => {
      // given the engine cleared completedAt when the run went back to running (todo 6(a))
      const resumed = runSnapshot({ status: "running", completedAt: undefined })

      // when
      const wireRun = payloadRuns([resumed])[0]

      // then
      expect(wireRun?.status).toBe("running")
      expect(wireRun).not.toHaveProperty("completed_at")
    })

    it("#when the run is terminal #then completed_at still reaches the wire", () => {
      // given
      const settled = runSnapshot({ status: "completed", completedAt: "2026-08-14T00:00:09.000Z" })

      // when
      const wireRun = payloadRuns([settled])[0]

      // then
      expect(wireRun?.completed_at).toBe("2026-08-14T00:00:09.000Z")
    })
  })

  describe("#given a paused run holding a resume lease", () => {
    it("#when the payload is built #then lease_holder_pid reaches the wire", () => {
      // given a paused run claimed by a resuming host
      const runs = payloadRuns([runSnapshot({ status: "paused", leaseHolderPid: 4242 })])

      // then a viewer can tell resuming apart from parked instead of guessing from status alone
      expect(runs[0]?.lease_holder_pid).toBe(4242)
    })

    it("#when the run holds no lease #then lease_holder_pid is absent rather than null", () => {
      // given / when
      const runs = payloadRuns([runSnapshot({ status: "paused" })])

      // then
      expect(runs[0]).not.toHaveProperty("lease_holder_pid")
    })
  })

  describe("#given the omo-desktop-app reducer contract", () => {
    it("#when a plain run is serialized #then the existing field order and names are untouched", () => {
      // given / when
      const payload = dagUpdatedPayload("ses_parent", [runSnapshot()])

      // then the new fields are additive: absent here, and everything else is byte-identical
      expect(payload).toEqual({
        parent_session_id: "ses_parent",
        runs: [
          {
            run_id: "dag_1",
            run_key: "key_dag_1",
            name: "run dag_1",
            status: "running",
            created_at: "2026-08-14T00:00:00.000Z",
            updated_at: "2026-08-14T00:00:01.000Z",
            counts: { total: 1, completed: 0, failed: 0, running: 1 },
            nodes: [
              {
                id: "build",
                prompt: "build it",
                depends_on: [],
                state: "running",
                attempt: 1,
                created_at: "2026-08-14T00:00:00.000Z",
              },
            ],
            edges: [],
            waves: [{ index: 0, node_ids: ["build"] }],
          },
        ],
      })
    })
  })
})
