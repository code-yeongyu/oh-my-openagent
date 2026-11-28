import { describe, expect, test } from "bun:test"

import { DAG_NODE_QUIET_AFTER_MS } from "@oh-my-opencode/senpi-task/dag"

import { AWAITING_REVIVAL_ACTIVITY, awaitingRevivalNotice, quietNodesNotice } from "./dag-quiet-nodes"

const NOW = Date.parse("2026-09-22T16:00:58.000Z")

function agoIso(ms: number): string {
  return new Date(NOW - ms).toISOString()
}

describe("dag quiet node notice (#8674)", () => {
  test("#given a running node quiet past the threshold #when the notice is built #then it names the node and the silence", () => {
    const notice = quietNodesNotice(
      [{ id: "clone-profile", state: "running", lastActivityAt: agoIso(50 * 60_000) }],
      NOW,
    )

    expect(notice).toBe(" Quiet children, no transcript activity: clone-profile (50m).")
  })

  test("#given a running node active within the threshold #when the notice is built #then it stays empty", () => {
    const notice = quietNodesNotice(
      [{ id: "clone-sources", state: "running", lastActivityAt: agoIso(DAG_NODE_QUIET_AFTER_MS - 1000) }],
      NOW,
    )

    expect(notice).toBe("")
  })

  test("#given completed nodes and a node with no activity clock #when the notice is built #then neither is reported as quiet", () => {
    const notice = quietNodesNotice(
      [
        { id: "clone-index", state: "completed", lastActivityAt: agoIso(90 * 60_000) },
        { id: "clone-education", state: "running" },
      ],
      NOW,
    )

    expect(notice).toBe("")
  })

  test("#given several quiet nodes #when the notice is built #then every one is named in node order", () => {
    const notice = quietNodesNotice(
      [
        { id: "a", state: "running", lastActivityAt: agoIso(11 * 60_000) },
        { id: "b", state: "running", lastActivityAt: agoIso(60_000) },
        { id: "c", state: "running", lastActivityAt: agoIso(25 * 60_000) },
      ],
      NOW,
    )

    expect(notice).toBe(" Quiet children, no transcript activity: a (11m), c (25m).")
  })
})

describe("dag node waiting for its child's revival (#15150)", () => {
  const children: Record<string, { status: string; residency_state: string }> = {
    parked: { status: "running", residency_state: "rpc_detached" },
    queued: { status: "pending", residency_state: "persisted_only" },
    live: { status: "running", residency_state: "resident" },
    ended: { status: "error", residency_state: "persisted_only" },
  }
  const childRecord = (taskId: string) => children[taskId]

  test("#given running nodes whose unfinished child is suspended #when the notice is built #then it names them as not working yet", () => {
    const notice = awaitingRevivalNotice(
      [
        { id: "k-hang", state: "running", taskId: "parked" },
        { id: "k-queued", state: "scheduled", taskId: "queued" },
      ],
      childRecord,
    )

    expect(notice).toContain(AWAITING_REVIVAL_ACTIVITY)
    expect(notice).toContain("k-hang, k-queued")
  })

  test("#given a live child, a finished child and a settled node #when the notice is built #then none is reported as waiting", () => {
    const notice = awaitingRevivalNotice(
      [
        { id: "working", state: "running", taskId: "live" },
        { id: "folding", state: "running", taskId: "ended" },
        { id: "done", state: "completed", taskId: "parked" },
      ],
      childRecord,
    )

    expect(notice).toBe("")
  })
})
