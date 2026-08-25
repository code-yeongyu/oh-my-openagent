import { describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import {
  DAG_WAKE_SOURCE,
  DAG_WAKE_SOURCE_STATE_EVENT,
  createDagWakeSource,
  type DagWakeSourceRunSnapshot,
  type DagWakeSourceRunSummary,
} from "./dag-wake-source"

const SESSION_ID = "parent-session"

interface RunFixture {
  readonly runId: string
  readonly name: string
  status: string
  readonly createdAt: string
  readonly startedAt?: string
}

function createHarness(runs: RunFixture[] = []) {
  const emitted: Array<{ name: string; data: unknown }> = []
  const pi = new FakeExtensionAPI()
  pi.events = {
    emit: (name, data) => emitted.push({ name, data }),
    on: () => () => {},
  }
  const listLive = (): readonly DagWakeSourceRunSummary[] =>
    runs.map((run) => ({ runId: run.runId, status: run.status }))
  let list: () => readonly DagWakeSourceRunSummary[] = listLive
  const manager = {
    list: (parentSessionId: string): readonly DagWakeSourceRunSummary[] =>
      parentSessionId === SESSION_ID ? list() : [],
    snapshot: (runId: string): DagWakeSourceRunSnapshot => {
      const run = runs.find((candidate) => candidate.runId === runId)
      if (run === undefined) throw new Error(`unknown run ${runId}`)
      return {
        runId: run.runId,
        name: run.name,
        status: run.status,
        createdAt: run.createdAt,
        ...(run.startedAt === undefined ? {} : { startedAt: run.startedAt }),
      }
    },
  }
  const wakeSource = createDagWakeSource({
    pi,
    manager,
    sessionId: () => SESSION_ID,
  })
  return {
    emitted,
    listLive,
    pi,
    runs,
    setList: (next: () => readonly DagWakeSourceRunSummary[]) => {
      list = next
    },
    wakeSource,
  }
}

function runFixture(overrides: Partial<RunFixture> = {}): RunFixture {
  return {
    runId: "dag_00000001",
    name: "release-pipeline",
    status: "running",
    createdAt: "2026-08-08T01:02:03.000Z",
    startedAt: "2026-08-08T01:02:05.000Z",
    ...overrides,
  }
}

describe("createDagWakeSource", () => {
  it("#given one live run #when the run starts #then it emits activeCount 1 carrying that run as a channel", () => {
    // given
    const first = runFixture()
    const harness = createHarness([first])

    // when
    harness.wakeSource.onRunStart(first.runId)

    // then
    expect(harness.emitted).toEqual([{
      name: DAG_WAKE_SOURCE_STATE_EVENT,
      data: {
        source: DAG_WAKE_SOURCE,
        activeCount: 1,
        channels: [{
          id: first.runId,
          description: first.name,
          startedAtMs: Date.parse("2026-08-08T01:02:05.000Z"),
        }],
      },
    }])
  })

  it("#given a live run #when a second run starts #then the emission aggregates both channels as activeCount 2", () => {
    // given
    const first = runFixture()
    const second = runFixture({
      runId: "dag_00000002",
      name: "docs-refresh",
      createdAt: "2026-08-08T01:03:00.000Z",
      startedAt: undefined,
    })
    const harness = createHarness([first])
    harness.wakeSource.onRunStart(first.runId)
    harness.emitted.length = 0

    // when
    harness.runs.push(second)
    harness.wakeSource.onRunStart(second.runId)

    // then a run that has not stamped startedAt falls back to its creation time
    expect(harness.emitted).toEqual([{
      name: DAG_WAKE_SOURCE_STATE_EVENT,
      data: {
        source: DAG_WAKE_SOURCE,
        activeCount: 2,
        channels: [
          {
            id: first.runId,
            description: first.name,
            startedAtMs: Date.parse("2026-08-08T01:02:05.000Z"),
          },
          {
            id: second.runId,
            description: second.name,
            startedAtMs: Date.parse("2026-08-08T01:03:00.000Z"),
          },
        ],
      },
    }])
  })

  it("#given two live runs #when both reach a terminal status #then the last emission clears the state with activeCount 0", () => {
    // given
    const first = runFixture()
    const second = runFixture({ runId: "dag_00000002", name: "docs-refresh", startedAt: "2026-08-08T01:03:00.000Z" })
    const harness = createHarness([first, second])
    harness.wakeSource.onRunStart(first.runId)
    harness.wakeSource.onRunStart(second.runId)
    harness.emitted.length = 0

    // when
    first.status = "completed"
    harness.wakeSource.onRunTerminal(first.runId)
    second.status = "failed"
    harness.wakeSource.onRunTerminal(second.runId)

    // then the intermediate state keeps the still-live run, and the final one clears
    expect(harness.emitted).toEqual([
      {
        name: DAG_WAKE_SOURCE_STATE_EVENT,
        data: {
          source: DAG_WAKE_SOURCE,
          activeCount: 1,
          channels: [{
            id: second.runId,
            description: second.name,
            startedAtMs: Date.parse("2026-08-08T01:03:00.000Z"),
          }],
        },
      },
      {
        name: DAG_WAKE_SOURCE_STATE_EVENT,
        data: { source: DAG_WAKE_SOURCE, activeCount: 0, channels: [] },
      },
    ])
  })

  it("#given a run left paused #when the session shuts down #then the final emission clears the state so no stale wake source outlives the session", () => {
    // given
    const paused = runFixture({ status: "paused" })
    const harness = createHarness([paused])
    harness.wakeSource.onRunStart(paused.runId)
    harness.emitted.length = 0

    // when
    harness.wakeSource.emitShutdown()

    // then
    expect(harness.emitted).toEqual([{
      name: DAG_WAKE_SOURCE_STATE_EVENT,
      data: { source: DAG_WAKE_SOURCE, activeCount: 0, channels: [] },
    }])
  })

  it("#given a run that starts, goes terminal and outlives shutdown #when every lifecycle hook fires #then the module never injects a message and never triggers a turn", () => {
    // given
    const run = runFixture()
    const harness = createHarness([run])

    // when
    harness.wakeSource.onRunStart(run.runId)
    run.status = "completed"
    harness.wakeSource.onRunTerminal(run.runId)
    harness.wakeSource.emitShutdown()

    // then liveness only: no message injection, no user message, no rpc turn trigger
    expect(harness.pi.messages.length).toBe(0)
    expect(harness.pi.userMessages.length).toBe(0)
    expect(harness.pi.rpcEvents.length).toBe(0)
    expect(harness.emitted.every((event) => event.name === DAG_WAKE_SOURCE_STATE_EVENT)).toBe(true)
  })

  it("#given no resolvable session #when a run start is reported #then it still emits a cleared state rather than going silent", () => {
    // given
    const emitted: Array<{ name: string; data: unknown }> = []
    const pi = new FakeExtensionAPI()
    pi.events = {
      emit: (name, data) => emitted.push({ name, data }),
      on: () => () => {},
    }
    const wakeSource = createDagWakeSource({
      pi,
      manager: {
        list: () => [],
        snapshot: () => {
          throw new Error("no session scope")
        },
      },
      sessionId: () => undefined,
    })

    // when
    wakeSource.onRunStart("dag_00000001")

    // then
    expect(emitted).toEqual([{
      name: DAG_WAKE_SOURCE_STATE_EVENT,
      data: { source: DAG_WAKE_SOURCE, activeCount: 0, channels: [] },
    }])
  })

  it("#given a run pruned between list and snapshot #when the state is republished #then the surviving run still reports as live", () => {
    // given a listed run whose snapshot read fails because it was pruned mid-flight
    const survivor = runFixture({ runId: "dag_00000002", name: "docs-refresh", startedAt: "2026-08-08T01:03:00.000Z" })
    const harness = createHarness([survivor])
    const listWithGhost = () => [{ runId: "dag_ghost", status: "running" }, ...harness.listLive()]
    harness.setList(listWithGhost)

    // when
    harness.wakeSource.onRunStart(survivor.runId)

    // then
    expect(harness.emitted).toEqual([{
      name: DAG_WAKE_SOURCE_STATE_EVENT,
      data: {
        source: DAG_WAKE_SOURCE,
        activeCount: 1,
        channels: [{
          id: survivor.runId,
          description: survivor.name,
          startedAtMs: Date.parse("2026-08-08T01:03:00.000Z"),
        }],
      },
    }])
  })
})
