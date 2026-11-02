import { EventEmitter } from "node:events"
import type { ChildProcess } from "node:child_process"
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"

import { createRpcChildHandle } from "./handle"
import type { RpcProtocolClient } from "./protocol-client"
import { createChildExtensionEvents } from "../child-extension-events"
import type { TerminateOptions } from "../types"

// omo#9471: a kill is recorded from the runner's own terminate(), never inferred from stderr. On
// Windows a killed child exits with code 1 and no signal, and its teardown can write memory diagnostics.
const MEMORY_TEARDOWN_STDERR = [
  "child reaper unavailable under Bun on win32: children orphaned by a terminated worker thread stay as zombies until this host exits",
  "memory shutdown drain hit its budget {",
  '  step: "facts-enqueue",',
  "}",
  "",
].join("\n")

// omo#9546: the fake child has a pid, and the default terminate signals its process GROUP on the real
// host running the suite. Every handle here stops its child through an injected fake instead, and no
// code path in this file may reach the real process.kill.
let realKill: ReturnType<typeof spyOn<typeof process, "kill">>

beforeEach(() => {
  realKill = spyOn(process, "kill").mockImplementation(() => {
    throw new Error("a fake rpc child reached the real process.kill")
  })
})

afterEach(() => {
  realKill.mockRestore()
})

function harness(stderrTail: string) {
  const child = Object.assign(new EventEmitter(), { pid: 5532, exitCode: null, signalCode: null, kill: () => true })
  const stopped: Array<{ readonly child: ChildProcess; readonly options?: TerminateOptions }> = []
  const client = {
    extensionEvents: createChildExtensionEvents(),
    stderrTail,
    exited: false,
    send: () => Promise.resolve({ success: true }),
    onEvent: () => () => undefined,
    detach: () => undefined,
  } as unknown as RpcProtocolClient
  const handle = createRpcChildHandle({
    client,
    child: child as unknown as ChildProcess,
    taskId: "st_00009471",
    heartbeatIntervalMs: 60_000,
    now: () => 1,
    terminateChild: async (stoppedChild, options) => {
      stopped.push({ child: stoppedChild, options })
    },
  })
  return { child, handle, stopped }
}

describe("a kill is the one the runner issued (omo#9471)", () => {
  test("#given the runner terminated the child #when it exits with code 1 and memory teardown lines on stderr #then the exit is killed", async () => {
    // given
    const { child, handle, stopped } = harness(MEMORY_TEARDOWN_STDERR)
    await handle.terminate({ sigkillDelayMs: 1 })

    // when
    child.emit("close", 1, null)

    // then
    expect((await handle.waitForExit()).kind).toBe("killed")
    expect(stopped).toEqual([{ child: child as unknown as ChildProcess, options: { sigkillDelayMs: 1 } }])
  })

  test("#given the runner did not terminate the child #when it exits with code 1 #then the exit is crashed whatever stderr says", async () => {
    // given
    const { child, handle, stopped } = harness("Error: killed\n")

    // when
    child.emit("close", 1, null)

    // then
    expect((await handle.waitForExit()).kind).toBe("crashed")
    expect(stopped).toEqual([])
  })
})

describe("a fake rpc child never signals the host (omo#9546)", () => {
  test("#given a handle over a fake child with a pid #when it is terminated #then the real process.kill is never called", async () => {
    // given
    const { handle } = harness("")

    // when
    await handle.terminate({ sigkillDelayMs: 1 })

    // then
    expect(realKill).not.toHaveBeenCalled()
  })
})
