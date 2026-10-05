import { describe, expect, test } from "bun:test"

import { DAG_NODE_QUIET_AFTER_MS } from "@oh-my-opencode/senpi-task/dag"

import { quietNodesNotice } from "./dag-quiet-nodes"

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
