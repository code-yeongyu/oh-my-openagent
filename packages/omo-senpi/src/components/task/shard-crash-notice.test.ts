import { describe, expect, test } from "bun:test"

import type { ReattachOutcome } from "@oh-my-opencode/senpi-task"
import { createShardCrashNotices, SHARD_CRASH_DONE_TOKEN, SHARD_CRASH_TOKEN } from "./shard-crash-notice"
import { SOCKET_A } from "./shard-crash-notice.test-support"

function harness() {
  const logs: Array<{ readonly event: string; readonly facts: Record<string, unknown> }> = []
  const crashReads: string[] = []
  const events = createShardCrashNotices({
    agentDir: "/tmp/dh-t10-agent",
    log: (event, facts) => logs.push({ event, facts }),
    readCrash: (_agentDir, socket, instanceId) => {
      crashReads.push(`${socket}#${instanceId}`)
      return { supervisorPid: 4242, cause: "SIGSEGV" }
    },
  })
  const lose = (taskId: string, instanceId = "gen-1", boundTaskIds = [taskId], turnWasInFlight = true) =>
    events.onTransportLost({ taskId, socket: SOCKET_A, instanceId, boundTaskIds, turnWasInFlight })
  const settle = (taskId: string, outcome: ReattachOutcome) =>
    events.onReattachOutcome({ taskId, socket: SOCKET_A, outcome })
  return { logs, crashReads, lose, settle }
}

describe("silent crash episode accounting (#10023)", () => {
  test("full reattach logs the crash and counts", () => {
    const f = harness()
    f.lose("st_a", "gen-1", ["st_a", "st_b"])
    f.lose("st_b")
    f.settle("st_a", "continued")
    expect(f.logs.filter((entry) => entry.event === SHARD_CRASH_DONE_TOKEN)).toHaveLength(0)
    f.settle("st_b", "resumed")
    expect(f.crashReads).toEqual([`${SOCKET_A}#gen-1`])
    expect(f.logs).toEqual([
      { event: SHARD_CRASH_TOKEN, facts: expect.objectContaining({ supervisorPid: 4242, cause: "SIGSEGV", members: 2, socket: SOCKET_A, instanceId: "gen-1" }) },
      { event: SHARD_CRASH_DONE_TOKEN, facts: expect.objectContaining({ reattached: 2, lost: 0, cancelled: 0 }) },
    ])
  })

  test("failed reattach is logged, not a second error notice before lifecycle recovery", () => {
    const f = harness()
    f.lose("st_a", "gen-1", ["st_a", "st_b", "st_c"])
    f.settle("st_a", "lost")
    f.settle("st_b", "attached")
    f.settle("st_c", "cancelled")
    f.settle("st_a", "lost")
    expect(f.logs.filter((entry) => entry.event === SHARD_CRASH_DONE_TOKEN)).toEqual([
      { event: SHARD_CRASH_DONE_TOKEN, facts: expect.objectContaining({ reattached: 1, lost: 1, cancelled: 1 }) },
    ])
  })

  test("new generations are counted separately and closed-generation stragglers stay silent", () => {
    const f = harness()
    f.lose("st_a")
    f.settle("st_a", "continued")
    f.lose("st_late")
    f.lose("st_a", "gen-2")
    f.settle("st_a", "continued")
    expect(f.crashReads).toEqual([`${SOCKET_A}#gen-1`, `${SOCKET_A}#gen-2`])
    expect(f.logs.filter((entry) => entry.event === SHARD_CRASH_TOKEN)).toHaveLength(2)
  })

  test("idle-child reattach also stays silent", () => {
    const f = harness()
    f.lose("st_a", "gen-1", ["st_a"], false)
    f.settle("st_a", "resumed")
    expect(f.logs).toEqual([])
  })
})
