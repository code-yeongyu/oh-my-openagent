import { describe, expect, test } from "bun:test"

import { crashRowsForReport } from "./task-host-e2e-shards-crash.mjs"

const KEY_A = "aaaaaaaaaaaaaaaa"
const KEY_B = "bbbbbbbbbbbbbbbb"
const SOCKET_A = `/tmp/dh41.x/crash/agent/rpc/p-${KEY_A}.sock`
const SOCKET_B = `/tmp/dh41.x/crash/agent/rpc/p-${KEY_B}.sock`

function facts() {
  const final = ["a0", "a1", "a2", "b0", "b1", "b2"].map((id) => ({
    task_id: id,
    parent: id.startsWith("a") ? "A" : "B",
    status: "completed",
  }))
  return {
    parentIds: ["A", "B"],
    crashedKey: KEY_A,
    crashedSocket: SOCKET_A,
    bystanderSocket: SOCKET_B,
    crashedInstanceBefore: "inst-a-1",
    notices: {
      crashed: [],
      bystander: [],
    },
    // The engine records /private/tmp on darwin; rows are matched by shard basename.
    statusAfter: {
      mode: "all",
      endpoints: [
        { socket: `/private${SOCKET_A}`, crashes: 1, instanceId: "inst-a-2" },
        { socket: `/private${SOCKET_B}`, crashes: 0, instanceId: "inst-b-1" },
      ],
    },
    sockets: [SOCKET_A, SOCKET_B],
    workersBefore: [],
    replaced: { socket: SOCKET_A, supervisor: 7 },
    final,
    continuations: { a0: 1, a1: 1, a2: 1, b0: 0, b1: 0, b2: 0 },
    bStable: true,
  }
}

const rows = (value) => crashRowsForReport(value, "/tmp/artifacts")
const failed = (value) => Object.entries(rows(value)).filter(([, row]) => row.status !== "pass").map(([id]) => id)

describe("crashRowsForReport", () => {
  test("silent recovery with a new host generation and completed children passes every row", () => {
    expect(failed(facts())).toEqual([])
  })

  const crashedMutations = {
    "a recovered crash emits a warning": (value) => value.notices.crashed.push(`host_shard_crash:${KEY_A} crash`),
    "a recovered crash emits a closing line": (value) => value.notices.crashed.push(`host_shard_crash_done:${KEY_A} done`),
    "another shard leaks a warning": (value) => value.notices.crashed.push(`host_shard_crash:${KEY_B} crash`),
    "the notice list was never read": (value) => {
      value.notices.crashed = null
    },
    "the crashed endpoint reports no crash": (value) => {
      value.statusAfter.endpoints[0].crashes = 0
    },
    "the crashed endpoint kept its instance": (value) => {
      value.statusAfter.endpoints[0].instanceId = "inst-a-1"
    },
    "the crashed endpoint is absent from status": (value) => value.statusAfter.endpoints.splice(0, 1),
    "status degraded to per-socket probes": (value) => {
      value.statusAfter.mode = "degraded"
    },
  }

  for (const [name, mutate] of Object.entries(crashedMutations)) {
    test(`crashed_shard_reattaches fails when ${name}`, () => {
      const value = facts()
      mutate(value)
      const report = rows(value)
      expect(report.crashed_shard_reattaches.status).toBe("fail")
      expect(report.crashed_shard_reattaches.reason.length).toBeGreaterThan(0)
      expect(report.topology_two_parent_shards.status).toBe("pass")
      expect(report.all_six_children_complete.status).toBe("pass")
    })
  }

  const bystanderMutations = {
    "the bystander is told of the crash": (value) => value.notices.bystander.push(`host_shard_crash:${KEY_A} crash`),
    "the bystander gets a closing line": (value) => value.notices.bystander.push(`host_shard_crash_done:${KEY_A} done`),
    "the bystander notice list was never read": (value) => {
      value.notices.bystander = null
    },
    "the bystander endpoint reports a crash": (value) => {
      value.statusAfter.endpoints[1].crashes = 1
    },
    "the bystander endpoint is absent from status": (value) => value.statusAfter.endpoints.splice(1, 1),
  }

  for (const [name, mutate] of Object.entries(bystanderMutations)) {
    test(`host_crash_isolated fails when ${name}`, () => {
      const value = facts()
      mutate(value)
      const report = rows(value)
      expect(report.host_crash_isolated.status).toBe("fail")
      expect(report.host_crash_isolated.reason.length).toBeGreaterThan(0)
      expect(report.crashed_shard_reattaches.status).toBe("pass")
    })
  }
})
