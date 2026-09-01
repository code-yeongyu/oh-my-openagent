import { describe, expect, test } from "bun:test"

import type { ChildHandle as InProcessChildHandle, RunnerOutcome } from "../runners/in-process/child-handle"
import type { ChildExitOutcome, RpcChildHandle, RpcTerminalAssistantMessage } from "../runners/types"
import { adaptInProcessHandle, adaptRpcHandle } from "./child-handle"

function fakeInProcessHandle(outcome: RunnerOutcome): InProcessChildHandle {
  let disposed = false
  return {
    task_id: "st_00000001",
    sessionId: "child-session-1",
    steer: () => Promise.resolve(),
    followUp: () => Promise.resolve(),
    abort: () => Promise.resolve(),
    subscribe: () => () => {},
    waitForIdle: () => Promise.resolve(outcome),
    lastAssistantText: () => "final text",
    dispose: () => {
      disposed = true
    },
    get __disposed() {
      return disposed
    },
  } as InProcessChildHandle & { __disposed: boolean }
}

type FakeRpcOptions = {
  readonly exit?: ChildExitOutcome
  readonly terminal?: RpcTerminalAssistantMessage
  readonly abortedByUser?: boolean
}

function fakeRpcHandle(options: FakeRpcOptions = {}): RpcChildHandle {
  return {
    task_id: "st_00000002",
    sessionId: "rpc-session-2",
    pid: 4242,
    steer: () => Promise.resolve(),
    followUp: () => Promise.resolve(),
    abort: () => Promise.resolve(),
    subscribe: () => () => {},
    waitForIdle: () => Promise.resolve(),
    lastAssistantText: () => options.terminal?.text,
    terminalAssistantMessage: () => options.terminal,
    wasAbortedByUser: () => options.abortedByUser === true,
    dispose: () => Promise.resolve(),
    terminate: () => Promise.resolve(),
    exitOutcome: () => options.exit,
    waitForExit: () => Promise.resolve(options.exit ?? { kind: "clean", facts: { pid: 4242, code: 0, signal: null, stderrTail: "" } }),
    lastSeen: () => undefined,
  }
}

describe("adaptInProcessHandle", () => {
  test("#given an in-process handle #when adapted #then pid is undefined and the outcome is forwarded", async () => {
    // given
    const handle = adaptInProcessHandle(fakeInProcessHandle({ status: "completed", finalResponse: "done" }))

    // when
    const outcome = await handle.waitForOutcome()

    // then
    expect(handle.pid).toBeUndefined()
    expect(handle.sessionId).toBe("child-session-1")
    expect(outcome).toEqual({ status: "completed", finalResponse: "done" })
  })

  test("#given an in-process handle #when disposed via the seam #then dispose resolves as a promise", async () => {
    // given
    const handle = adaptInProcessHandle(fakeInProcessHandle({ status: "cancelled" }))

    // when
    await handle.dispose()

    // then
    const outcome = await handle.waitForOutcome()
    expect(outcome).toEqual({ status: "cancelled" })
  })
})

describe("adaptRpcHandle", () => {
  test("#given an rpc terminal provider error on a resident process #when adapted #then the outcome is a child-turn error carrying the provider message", async () => {
    // given
    const handle = adaptRpcHandle(
      fakeRpcHandle({ terminal: { stopReason: "error", errorMessage: "401 unauthorized; re-authenticate" } }),
    )

    // when
    const outcome = await handle.waitForOutcome()

    // then
    expect(outcome).toEqual({
      status: "error",
      failure: { kind: "child-turn-failed", message: "401 unauthorized; re-authenticate" },
    })
  })

  test("#given an rpc terminal non-user abort #when adapted #then the outcome is a child-turn error", async () => {
    // given
    const handle = adaptRpcHandle(fakeRpcHandle({ terminal: { stopReason: "aborted" } }))

    // when
    const outcome = await handle.waitForOutcome()

    // then
    expect(outcome).toEqual({
      status: "error",
      failure: { kind: "child-turn-failed", message: 'child turn ended with stopReason "aborted"' },
    })
  })

  test("#given an rpc turn explicitly aborted by the user #when adapted #then the outcome remains cancelled", async () => {
    // given
    const handle = adaptRpcHandle(
      fakeRpcHandle({ terminal: { stopReason: "aborted", errorMessage: "operation aborted" }, abortedByUser: true }),
    )

    // when
    const outcome = await handle.waitForOutcome()

    // then
    expect(outcome).toEqual({ status: "cancelled" })
  })

  test("#given an rpc clean turn with no assistant output #when adapted #then the outcome is a child-turn error", async () => {
    // given
    const handle = adaptRpcHandle(fakeRpcHandle({ terminal: { stopReason: "stop" } }))

    // when
    const outcome = await handle.waitForOutcome()

    // then
    expect(outcome).toEqual({
      status: "error",
      failure: { kind: "child-turn-failed", message: "child turn produced no assistant output" },
    })
  })

  test("#given an rpc clean turn with assistant text #when adapted #then the outcome is completed", async () => {
    // given
    const handle = adaptRpcHandle(fakeRpcHandle({ terminal: { text: "rpc final", stopReason: "stop" } }))

    // when
    const outcome = await handle.waitForOutcome()

    // then
    expect(handle.pid).toBe(4242)
    expect(handle.sessionId).toBe("rpc-session-2")
    expect(outcome).toEqual({ status: "completed", finalResponse: "rpc final" })
  })

  test("#given an rpc handle that crashed #when adapted #then the outcome is an error carrying the stderr tail", async () => {
    // given
    const handle = adaptRpcHandle(
      fakeRpcHandle({ exit: { kind: "crashed", facts: { pid: 4242, code: 1, signal: null, stderrTail: "boom" } } }),
    )

    // when
    const outcome = await handle.waitForOutcome()

    // then
    expect(outcome.status).toBe("error")
    if (outcome.status !== "error") throw new Error("expected error outcome")
    expect(outcome.failure.kind).toBe("child-prompt-failed")
    expect(outcome.failure.message).toContain("boom")
  })
})
