import { EventEmitter } from "node:events"
import type { ChildProcess } from "node:child_process"
import { describe, expect, test } from "bun:test"

import { createRpcChildHandle } from "./handle"
import type { RpcProtocolClient } from "./protocol-client"
import { createChildExtensionEvents } from "../child-extension-events"

// omo#9471: a kill is recorded from the runner's own terminate(), never inferred from stderr. On
// Windows a killed child exits with code 1 and no signal, and its teardown can write memory diagnostics.
const MEMORY_TEARDOWN_STDERR = [
  "child reaper unavailable under Bun on win32: children orphaned by a terminated worker thread stay as zombies until this host exits",
  "memory shutdown drain hit its budget {",
  '  step: "facts-enqueue",',
  "}",
  "",
].join("\n")

function harness(stderrTail: string) {
  const child = Object.assign(new EventEmitter(), { pid: 5532, exitCode: null, signalCode: null, kill: () => true })
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
  })
  return { child, handle }
}

describe("a kill is the one the runner issued (omo#9471)", () => {
  test("#given the runner terminated the child #when it exits with code 1 and memory teardown lines on stderr #then the exit is killed", async () => {
    // given
    const { child, handle } = harness(MEMORY_TEARDOWN_STDERR)
    void handle.terminate({ sigkillDelayMs: 1 })

    // when
    child.emit("close", 1, null)

    // then
    expect((await handle.waitForExit()).kind).toBe("killed")
  })

  test("#given the runner did not terminate the child #when it exits with code 1 #then the exit is crashed whatever stderr says", async () => {
    // given
    const { child, handle } = harness("Error: killed\n")

    // when
    child.emit("close", 1, null)

    // then
    expect((await handle.waitForExit()).kind).toBe("crashed")
  })
})
