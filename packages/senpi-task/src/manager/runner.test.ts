import { describe, expect, test } from "bun:test"

import type { ChildHandle as InProcessChildHandle, RunnerOutcome } from "../runners/in-process/child-handle"
import type { ChildSpec } from "../runners/in-process"
import type { RpcChildHandle, RpcRunnerSpec } from "../runners/types"
import { createInProcessManagedRunner, createRpcManagedRunner, type InProcessRunnerLike, type RpcRunnerLike } from "./runner"
import type { ManagedStartSpec } from "./types"

function managedSpec(): ManagedStartSpec {
  return {
    taskId: "st_00000001",
    cwd: "/tmp/project",
    stateDir: "/tmp/project/.omo/senpi-task/children/st_00000001",
    prompt: "do it",
    depth: 1,
    parentSessionId: "parent-1",
    rootSessionId: "parent-1",
    model: "anthropic/claude",
  }
}

function fakeInProcessHandle(outcome: RunnerOutcome): InProcessChildHandle {
  return {
    task_id: "st_00000001",
    sessionId: "child-1",
    steer: () => Promise.resolve(),
    followUp: () => Promise.resolve(),
    abort: () => Promise.resolve(),
    subscribe: () => () => {},
    waitForIdle: () => Promise.resolve(outcome),
    lastAssistantText: () => undefined,
    dispose: () => {},
  }
}

function fakeRpcHandle(): RpcChildHandle {
  return {
    task_id: "st_00000001",
    sessionId: "rpc-1",
    pid: 99,
    steer: () => Promise.resolve(),
    followUp: () => Promise.resolve(),
    abort: () => Promise.resolve(),
    subscribe: () => () => {},
    waitForIdle: () => Promise.resolve(),
    lastAssistantText: () => "done",
    dispose: () => Promise.resolve(),
    terminate: () => Promise.resolve(),
    exitOutcome: () => undefined,
    waitForExit: () => Promise.resolve({ kind: "clean", facts: { pid: 99, code: 0, signal: null, stderrTail: "" } }),
    lastSeen: () => undefined,
  }
}

describe("createInProcessManagedRunner", () => {
  test("#given a managed spec #when started #then it maps to a ChildSpec and injects session context", async () => {
    // given
    let captured: ChildSpec | undefined
    const runner: InProcessRunnerLike = {
      start: (spec) => {
        captured = spec
        return Promise.resolve(fakeInProcessHandle({ status: "completed", finalResponse: "ok" }))
      },
    }
    const managed = createInProcessManagedRunner(runner, () => ({ agentDir: "/home/user/.senpi/agent" }))

    // when
    const handle = await managed.start(managedSpec())
    const outcome = await handle.waitForOutcome()

    // then
    expect(captured?.taskId).toBe("st_00000001")
    expect(captured?.agentDir).toBe("/home/user/.senpi/agent")
    expect(captured?.parentSessionId).toBe("parent-1")
    expect(outcome).toEqual({ status: "completed", finalResponse: "ok" })
  })
})

describe("createRpcManagedRunner", () => {
  test("#given a managed spec #when started #then it maps stateDir to state_dir and adapts the handle", async () => {
    // given
    let captured: RpcRunnerSpec | undefined
    const runner: RpcRunnerLike = {
      start: (spec) => {
        captured = spec
        return fakeRpcHandle()
      },
    }
    const managed = createRpcManagedRunner(runner)

    // when
    const handle = await managed.start(managedSpec())

    // then
    expect(captured?.state_dir).toBe("/tmp/project/.omo/senpi-task/children/st_00000001")
    expect(captured?.prompt).toBe("do it")
    expect(handle.pid).toBe(99)
  })

  test("#given a managed spec with a model #when started #then the model is threaded onto the rpc spec for the detached child", async () => {
    // given
    let captured: RpcRunnerSpec | undefined
    const runner: RpcRunnerLike = {
      start: (spec) => {
        captured = spec
        return fakeRpcHandle()
      },
    }
    const managed = createRpcManagedRunner(runner)

    // when
    await managed.start(managedSpec())

    // then: a separate OS process cannot share the parent's registry, so the model rides the spec
    expect(captured?.model).toBe("anthropic/claude")
  })
})
