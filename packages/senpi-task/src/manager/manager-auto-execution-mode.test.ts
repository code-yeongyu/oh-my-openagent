import { afterEach, describe, expect, test } from "bun:test"

import type { ManagedChildHandle } from "./child-handle"
import { createExecutionModeGate, type ExecutionMode } from "./execution-mode"
import { FakeRunner, baseSpec, cleanupProjects, makeManager, settings } from "./__fixtures__/manager-fakes"
import type { ManagedRunner, ManagedStartSpec } from "./types"

afterEach(cleanupProjects)

// A handle shaped like the one RpcHostRunner returns: no pid, a session of the shared daemon, and
// the identity the record must carry so a later process can reattach to that session.
function hostSessionRunner(): { readonly runner: ManagedRunner; readonly specs: ManagedStartSpec[] } {
  const specs: ManagedStartSpec[] = []
  return {
    specs,
    runner: {
      start: (spec) => {
        specs.push(spec)
        const handle: ManagedChildHandle = {
          task_id: spec.taskId,
          kind: "host-session",
          sessionId: "child-session-1",
          pid: undefined,
          hostSession: {
            socket: "/tmp/dh-agent/rpc/rpc.sock",
            routingId: "routing-1",
            sessionPath: "/tmp/dh-state/sessions/st_1/s.jsonl",
            instanceId: "instance-1",
          },
          steer: () => Promise.resolve(),
          followUp: () => Promise.resolve(),
          abort: () => Promise.resolve(),
          subscribe: () => () => {},
          waitForOutcome: () => new Promise(() => {}),
          lastAssistantText: () => undefined,
          dispose: () => Promise.resolve(),
        }
        return Promise.resolve(handle)
      },
    },
  }
}

function gateOf(mode: ExecutionMode, counter: { calls: number }) {
  return createExecutionModeGate(() => {
    counter.calls += 1
    return Promise.resolve(mode)
  })
}

describe("manager auto execution mode", () => {
  test("#given task.default_execution_mode auto and a daemon-capable gate #when a child starts #then the record runs in process mode on the process runner", async () => {
    // given
    const counter = { calls: 0 }
    const host = hostSessionRunner()
    const inProcess = new FakeRunner()
    const { manager } = makeManager({
      config: settings({ default_execution_mode: "auto" }),
      inProcess,
      process: host.runner,
      executionModeGate: gateOf("process", counter),
    })

    // when
    const started = await manager.start(baseSpec())

    // then
    if (started.kind !== "started") throw new Error(`expected a started child, got ${started.kind}`)
    expect(manager.get(started.task_id)?.execution_mode).toBe("process")
    expect(host.specs).toHaveLength(1)
    expect(inProcess.startedSpecs).toHaveLength(0)
  })

  test("#given a host-session handle #when the spawn facts are recorded #then the record carries runner_kind and the session identity", async () => {
    // given
    const counter = { calls: 0 }
    const host = hostSessionRunner()
    const { manager } = makeManager({
      config: settings({ default_execution_mode: "auto" }),
      process: host.runner,
      executionModeGate: gateOf("process", counter),
    })

    // when
    const started = await manager.start(baseSpec())

    // then
    if (started.kind !== "started") throw new Error(`expected a started child, got ${started.kind}`)
    const record = manager.get(started.task_id)
    expect(record?.runner_kind).toBe("host-session")
    expect(record?.host_session).toEqual({
      socket: "/tmp/dh-agent/rpc/rpc.sock",
      routing_id: "routing-1",
      session_path: "/tmp/dh-state/sessions/st_1/s.jsonl",
      instance_id: "instance-1",
    })
    expect(record?.pid).toBeUndefined()
  })

  test("#given a user-set in-process default #when the gate would say process #then the user value is honored and the daemon is never asked", async () => {
    // given
    const counter = { calls: 0 }
    const host = hostSessionRunner()
    const inProcess = new FakeRunner()
    const { manager } = makeManager({
      config: settings({ default_execution_mode: "in-process" }),
      inProcess,
      process: host.runner,
      executionModeGate: gateOf("process", counter),
    })

    // when
    const started = await manager.start(baseSpec())

    // then
    if (started.kind !== "started") throw new Error(`expected a started child, got ${started.kind}`)
    expect(manager.get(started.task_id)?.execution_mode).toBe("in-process")
    expect(inProcess.startedSpecs).toHaveLength(1)
    expect(host.specs).toHaveLength(0)
    expect(counter.calls).toBe(0)
  })

  test("#given a curated agent pinned to in-process #when auto resolved to process #then that child still runs in-process", async () => {
    // given
    const counter = { calls: 0 }
    const host = hostSessionRunner()
    const inProcess = new FakeRunner()
    const { manager } = makeManager({
      config: settings({ default_execution_mode: "auto" }),
      inProcess,
      process: host.runner,
      planner: () => ({ kind: "resolved", plan: { model: "anthropic/claude", agentExecutionMode: "in-process" } }),
      executionModeGate: gateOf("process", counter),
    })

    // when
    const started = await manager.start(baseSpec({ category: undefined, subagent_type: "explore" }))

    // then
    if (started.kind !== "started") throw new Error(`expected a started child, got ${started.kind}`)
    expect(manager.get(started.task_id)?.execution_mode).toBe("in-process")
    expect(host.specs).toHaveLength(0)
  })

  test("#given two children in one parent session #when both start under auto #then the daemon was asked exactly once", async () => {
    // given
    const counter = { calls: 0 }
    const host = hostSessionRunner()
    const { manager } = makeManager({
      config: settings({ default_execution_mode: "auto", default_concurrency: 5 }),
      process: host.runner,
      executionModeGate: gateOf("process", counter),
    })

    // when
    await manager.start(baseSpec())
    await manager.start(baseSpec())

    // then
    expect(host.specs).toHaveLength(2)
    expect(counter.calls).toBe(1)
  })
})
