import { afterEach, describe, expect, test } from "bun:test"

import { world, sockets, suspendedChild, removeWorldDirs } from "./host-prewarm.test-support"

afterEach(removeWorldDirs)

describe("revival pre-warm ensures the recorded hosts of suspended host-session children", () => {
  test("#given off and a root session with children on p-A and rpc.sock #when session_start fires #then each distinct recorded socket is ensured once", async () => {
    // given
    const w = world({ prewarm: "off" })
    const pA = w.shard("p-aaaaaaaaaaaaaaaa")
    w.records.push(
      suspendedChild("root-1", pA),
      suspendedChild("root-1", pA, { residency_state: "persisted_only", status: "interrupted" }),
      suspendedChild("root-1", w.legacy, { status: "pending" }),
      suspendedChild("other-session", w.shard("p-bbbbbbbbbbbbbbbb")),
      suspendedChild("root-1", w.shard("p-cccccccccccccccc"), { status: "completed" }),
      suspendedChild("root-1", w.shard("p-dddddddddddddddd"), { residency_state: "resident" }),
      suspendedChild("root-1", w.shard("p-eeeeeeeeeeeeeeee"), { killed: true }),
    )

    // when
    await w.sessionStart("root-1")

    // then
    expect([...sockets(w.ensures)].sort()).toEqual([pA, w.legacy].sort())
  })

  test("#given the same children seen from a session living on p-A #when session_start fires #then only rpc.sock is ensured and p-A is neither ensured nor probed", async () => {
    // given
    const w = world({ prewarm: "off", ownShard: "p-aaaaaaaaaaaaaaaa" })
    const pA = w.shard("p-aaaaaaaaaaaaaaaa")
    w.records.push(
      suspendedChild("child-1", pA, { host_session: { socket: pA, routing_id: "r-x", session_path: "/tmp/x.jsonl", instance_id: "H1" } }),
      suspendedChild("child-1", pA, { host_session: { socket: pA, routing_id: "r-y", session_path: "/tmp/y.jsonl", instance_id: "H2" } }),
      suspendedChild("child-1", w.legacy),
    )

    // when
    await w.sessionStart("child-1")

    // then
    expect(sockets(w.ensures)).toEqual([w.legacy])
    expect(w.probes).toEqual([])
  })

  test("#given a resumed session #when session_start fires again for the same id #then its recorded hosts are not warmed twice", async () => {
    // given
    const w = world({ prewarm: "off" })
    const pA = w.shard("p-aaaaaaaaaaaaaaaa")
    w.records.push(suspendedChild("root-1", pA), suspendedChild("root-2", w.legacy))

    // when
    await w.sessionStart("root-1")
    await w.sessionStart("root-1")
    await w.sessionStart("root-2")

    // then
    expect(sockets(w.ensures)).toEqual([pA, w.legacy])
  })

  test("#given residency_max_children 1 and three suspended children on three shards #when session_start fires #then only the host the reconcile will revive is warmed", async () => {
    // given
    const w = world({ prewarm: "off", residencyMaxChildren: 1 })
    const [pA, pB, pC] = ["p-aaaaaaaaaaaaaaaa", "p-bbbbbbbbbbbbbbbb", "p-cccccccccccccccc"].map(w.shard)
    w.records.push(
      suspendedChild("root-1", pA, { updated_at: "2026-09-27T10:00:00.000Z" }),
      suspendedChild("root-1", pB, { updated_at: "2026-09-27T12:00:00.000Z" }),
      suspendedChild("root-1", pC, { updated_at: "2026-09-27T11:00:00.000Z" }),
    )

    // when
    await w.sessionStart("root-1")

    // then
    expect(sockets(w.ensures)).toEqual([pB])
  })

  test("#given residency_max_children 2 with one child already resident #when session_start fires #then only one more host is warmed", async () => {
    // given
    const w = world({ prewarm: "off", residencyMaxChildren: 2 })
    const [pA, pB, pC] = ["p-aaaaaaaaaaaaaaaa", "p-bbbbbbbbbbbbbbbb", "p-cccccccccccccccc"].map(w.shard)
    w.records.push(
      suspendedChild("root-1", pA, { residency_state: "resident" }),
      suspendedChild("root-1", pB, { status: "interrupted", updated_at: "2026-09-27T12:00:00.000Z" }),
      suspendedChild("root-1", pC, { status: "pending", updated_at: "2026-09-27T09:00:00.000Z" }),
    )

    // when
    await w.sessionStart("root-1")

    // then: a non-terminal child outranks a more recent terminal one, as in the reconcile
    expect(sockets(w.ensures)).toEqual([pC])
  })

  test("#given reattach_on_reconcile off #when session_start fires #then no recorded host is warmed", async () => {
    // given
    const w = world({ prewarm: "off", reattachOnReconcile: false })
    w.records.push(suspendedChild("root-1", w.shard("p-aaaaaaaaaaaaaaaa")), suspendedChild("root-1", w.legacy))

    // when
    await w.sessionStart("root-1")

    // then
    expect(w.ensures).toEqual([])
  })

  test("#given resume_children off #when session_start fires #then no recorded host is warmed", async () => {
    // given
    const w = world({ prewarm: "off", resumeChildren: false })
    w.records.push(suspendedChild("root-1", w.legacy))

    // when
    await w.sessionStart("root-1")

    // then
    expect(w.ensures).toEqual([])
  })
})
