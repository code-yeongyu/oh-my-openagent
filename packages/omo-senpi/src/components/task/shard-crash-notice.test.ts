import { describe, expect, test } from "bun:test"

import { runTaskOutput, type ReattachOutcome, type TaskRecord } from "@oh-my-opencode/senpi-task"

import { makeRecord } from "../../../../senpi-task/src/tools/output/__fixtures__/records"
import { createHostNotices } from "./host-execution-mode"
import { createShardCrashNotices, SHARD_CRASH_DONE_TOKEN, SHARD_CRASH_TOKEN, type ShardCrashFacts } from "./shard-crash-notice"
import { doneCounts, linesWith, reattachingCount, SOCKET_A, uiRecorder } from "./shard-crash-notice.test-support"

// Todo 10: one parent-visible line per task-host crash and one when its children are back, on the
// notice list (task_output) and on ui.notify (TUI notice block, Desktop thread row). Asserted by
// their stable tokens and counts only.

const SOCKET_B = "/tmp/dh-t10/rpc/shards/p-bbbbbbbbbbbbbbbb.sock"

interface Loss {
  readonly socket?: string
  readonly instanceId?: string
  readonly turnWasInFlight?: boolean
  readonly boundTaskIds?: readonly string[]
}

function harness(options: { readonly withUi?: boolean } = {}) {
  const notices = createHostNotices(() => undefined)
  const { ui, notified } = uiRecorder()
  const crashReads: string[] = []
  const events = createShardCrashNotices({
    agentDir: "/tmp/dh-t10-agent",
    notices,
    ui: () => (options.withUi === false ? undefined : ui),
    readCrash: (_agentDir, socket, instanceId): ShardCrashFacts => {
      crashReads.push(`${socket}#${instanceId}`)
      return { supervisorPid: 4242, cause: "SIGSEGV" }
    },
  })
  const lose = (taskId: string, loss: Loss = {}): void =>
    events.onTransportLost({
      taskId,
      socket: loss.socket ?? SOCKET_A,
      instanceId: loss.instanceId ?? "gen-1",
      turnWasInFlight: loss.turnWasInFlight ?? true,
      ...(loss.boundTaskIds === undefined ? {} : { boundTaskIds: loss.boundTaskIds }),
    })
  const settle = (taskId: string, outcome: ReattachOutcome): void =>
    events.onReattachOutcome({ taskId, socket: SOCKET_A, outcome })
  return { notices, notified, crashReads, lose, settle }
}

describe("shard crash notice", () => {
  test("#given two children on one lost generation #when both report the loss back to back #then exactly one crash notice and one crash-record read", () => {
    // given
    const world = harness()

    // when
    world.lose("st_a")
    world.lose("st_b")

    // then
    expect(linesWith(world.notices.list(), SHARD_CRASH_TOKEN)).toHaveLength(1)
    expect(linesWith(world.notices.list(), SHARD_CRASH_TOKEN)[0]).toStartWith(`${SHARD_CRASH_TOKEN}:aaaaaaaaaaaaaaaa `)
    expect(world.crashReads).toEqual([`${SOCKET_A}#gen-1`])
  })

  test("#given the runner names two bound children at the first loss #when the second loss arrives only AFTER the warning #then the warning already counts 2", () => {
    // given
    const world = harness()

    // when
    world.lose("st_a", { boundTaskIds: ["st_a", "st_b"] })
    const warning = linesWith(world.notices.list(), SHARD_CRASH_TOKEN)[0] ?? ""
    world.lose("st_b", { boundTaskIds: ["st_b"] })

    // then
    expect(reattachingCount(warning)).toBe(2)
    expect(linesWith(world.notices.list(), SHARD_CRASH_TOKEN)).toHaveLength(1)
  })

  test("#given a bound child that has not reported its own loss #when its sibling settles #then the episode stays open until it settles too", () => {
    // given
    const world = harness()
    world.lose("st_a", { boundTaskIds: ["st_a", "st_b"] })

    // when
    world.settle("st_a", "continued")
    const beforeSecond = linesWith(world.notices.list(), SHARD_CRASH_DONE_TOKEN).length
    world.settle("st_b", "continued")

    // then
    expect(beforeSecond).toBe(0)
    expect(doneCounts(linesWith(world.notices.list(), SHARD_CRASH_DONE_TOKEN)[0] ?? "")).toEqual({ reattached: 2, lost: 0, cancelled: 0 })
  })

  test("#given the episode's children #when one continues and one is lost #then one done line with 1 reattached and 1 lost and exactly two notifies, warning then info", () => {
    // given
    const world = harness()
    world.lose("st_a")
    world.lose("st_b")

    // when
    world.settle("st_a", "continued")
    expect(linesWith(world.notices.list(), SHARD_CRASH_DONE_TOKEN)).toHaveLength(0)
    world.settle("st_b", "lost")

    // then
    const done = linesWith(world.notices.list(), SHARD_CRASH_DONE_TOKEN)
    expect(done).toHaveLength(1)
    expect(doneCounts(done[0] ?? "")).toEqual({ reattached: 1, lost: 1, cancelled: 0 })
    expect(world.notified.map((call) => call.type)).toEqual(["warning", "info"])
    expect(world.notified[0]?.text).toStartWith(`${SHARD_CRASH_TOKEN}:`)
    expect(world.notified[1]?.text).toStartWith(`${SHARD_CRASH_DONE_TOKEN}:`)
  })

  test("#given an episode #when one child continues and one was cancelled during reattach #then the cancelled child is counted apart, never as lost", () => {
    // given
    const world = harness()
    world.lose("st_a", { boundTaskIds: ["st_a", "st_b"] })

    // when
    world.settle("st_a", "continued")
    world.settle("st_b", "cancelled")

    // then
    expect(doneCounts(linesWith(world.notices.list(), SHARD_CRASH_DONE_TOKEN)[0] ?? "")).toEqual({ reattached: 1, lost: 0, cancelled: 1 })
  })

  test("#given each outcome mix #when the episode closes #then the done line reads the lost count first only when something was lost", () => {
    // given - the Desktop parses this exact shape into its one "Task host restarted" row
    const continued = harness()
    continued.lose("st_a")
    continued.settle("st_a", "continued")
    const lostOne = harness()
    lostOne.lose("st_a", { boundTaskIds: ["st_a", "st_b", "st_c"] })

    // when
    lostOne.settle("st_a", "lost")
    lostOne.settle("st_b", "resumed")
    lostOne.settle("st_c", "cancelled")

    // then
    expect(linesWith(continued.notices.list(), SHARD_CRASH_DONE_TOKEN)).toEqual([`${SHARD_CRASH_DONE_TOKEN}:aaaaaaaaaaaaaaaa 1 subagent reattached, 0 lost`])
    expect(linesWith(lostOne.notices.list(), SHARD_CRASH_DONE_TOKEN)).toEqual([
      `${SHARD_CRASH_DONE_TOKEN}:aaaaaaaaaaaaaaaa 1 subagent lost (reattach failed), 1 reattached, 1 cancelled`,
    ])
    expect(linesWith(lostOne.notices.list(), SHARD_CRASH_TOKEN)[0]).toEndWith("reattaching 3 subagents...")
    expect(linesWith(continued.notices.list(), SHARD_CRASH_TOKEN)[0]).toEndWith("reattaching 1 subagent...")
  })

  test("#given one crash in progress #when a child on a second socket loses its host #then that is a second notice", () => {
    // given
    const world = harness()
    world.lose("st_a")

    // when
    world.lose("st_c", { socket: SOCKET_B })

    // then
    const notices = linesWith(world.notices.list(), SHARD_CRASH_TOKEN)
    expect(notices.map((line) => line.split(" ")[0])).toEqual([
      `${SHARD_CRASH_TOKEN}:aaaaaaaaaaaaaaaa`,
      `${SHARD_CRASH_TOKEN}:bbbbbbbbbbbbbbbb`,
    ])
  })

  test("#given a finished episode #when the same socket loses a NEW generation #then a new notice, and a straggler of the old one adds none", () => {
    // given
    const world = harness()
    world.lose("st_a")
    world.settle("st_a", "continued")

    // when
    world.lose("st_late", { instanceId: "gen-1" })
    world.lose("st_a", { instanceId: "gen-2" })

    // then
    expect(world.notified.map((call) => call.type)).toEqual(["warning", "info", "warning"])
    expect(world.crashReads).toEqual([`${SOCKET_A}#gen-1`, `${SOCKET_A}#gen-2`])
  })

  test("#given a host that dies with no turn in flight #when its idle children recover #then nothing is announced", () => {
    // given
    const world = harness()

    // when
    world.lose("st_idle", { turnWasInFlight: false })
    world.settle("st_idle", "resumed")

    // then
    expect(world.notices.list()).toEqual([])
    expect(world.notified).toEqual([])
    expect(world.crashReads).toEqual([])
  })

  test("#given no captured UI #when an episode runs #then zero notifies and both lines still reach the notice list", () => {
    // given
    const world = harness({ withUi: false })

    // when
    world.lose("st_a")
    world.settle("st_a", "continued")

    // then
    expect(world.notified).toEqual([])
    expect(linesWith(world.notices.list(), SHARD_CRASH_TOKEN)).toHaveLength(1)
    expect(linesWith(world.notices.list(), SHARD_CRASH_DONE_TOKEN)).toHaveLength(1)
  })

  test("#given a finished episode #when task_output reads either child #then both lines are listed", async () => {
    // given
    const world = harness()
    world.lose("st_a", { boundTaskIds: ["st_a", "st_b"] })
    world.settle("st_a", "continued")
    world.settle("st_b", "lost")
    const records: TaskRecord[] = [
      makeRecord({ task_id: "st_a", status: "running" }),
      makeRecord({ task_id: "st_b", status: "running" }),
    ]
    const deps = {
      manager: {
        get: (taskId: string) => records.find((record) => record.task_id === taskId),
        list: () => records.map((record) => ({ record })),
      },
      stateDir: "/tmp/state",
      now: () => Date.parse("2024-12-03T15:00:00.000Z"),
      transcriptReader: () => ({ entries: [], source: "none" as const }),
      notices: world.notices.list,
    }

    for (const taskId of ["st_a", "st_b"]) {
      // when
      const result = await runTaskOutput(deps, { task_id: taskId }, "session-parent")

      // then
      const first = result.content[0]
      const lines = (first?.type === "text" ? first.text : "").split("\n").map((line) => line.replace(/^note: /, ""))
      expect(linesWith(lines, SHARD_CRASH_TOKEN)).toHaveLength(1)
      expect(linesWith(lines, SHARD_CRASH_DONE_TOKEN)).toHaveLength(1)
    }
  })
})
