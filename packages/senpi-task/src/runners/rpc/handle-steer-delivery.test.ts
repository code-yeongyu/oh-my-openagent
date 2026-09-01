import { EventEmitter } from "node:events"
import type { ChildProcess } from "node:child_process"
import type { RpcCommand, RpcResponse } from "@code-yeongyu/senpi"
import { describe, expect, test } from "bun:test"

import type { RpcChildHandle } from "../types"
import { createRpcChildHandle } from "./handle"
import type { RpcProtocolClient } from "./protocol-client"

// The exact rejection senpi's AgentSession.prompt() raises when a message lands on a
// streaming session without queueing semantics. Windows loses the startup race often
// enough that this reaches the RPC child and aborts it before any task record is flushed.
const BUSY_CHILD_REJECTION =
  "Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message."

type SentCommand = RpcCommand & { readonly streamingBehavior?: string; readonly message?: string }

type Harness = {
  readonly handle: RpcChildHandle & { startInitialPrompt(text: string): Promise<void> }
  readonly sent: SentCommand[]
}

function createHarness(respond: (command: SentCommand) => RpcResponse): Harness {
  const child = Object.assign(new EventEmitter(), { pid: 4242 }) as unknown as ChildProcess
  const sent: SentCommand[] = []
  const client = {
    stderrTail: "",
    send: (command: RpcCommand) => {
      const seen = command as SentCommand
      sent.push(seen)
      return Promise.resolve(respond(seen))
    },
    onEvent: () => () => {},
    detach: () => {},
  } as unknown as RpcProtocolClient
  const handle = createRpcChildHandle({
    client,
    child,
    taskId: "st_00000002",
    heartbeatIntervalMs: 60_000,
    now: () => 1,
  })
  return { handle, sent }
}

function ok(command: SentCommand): RpcResponse {
  return { type: "response", command: command.type, success: true } as RpcResponse
}

function busy(command: SentCommand): RpcResponse {
  return { type: "response", command: command.type, success: false, error: BUSY_CHILD_REJECTION } as RpcResponse
}

function commandsOfType(sent: readonly SentCommand[], type: string): SentCommand[] {
  return sent.filter((command) => command.type === type)
}

describe("rpc child delivery carries queueing semantics", () => {
  test("#given a mid-run initial prompt #when it is delivered #then the request declares steer semantics so a busy child cannot reject it", async () => {
    // given
    const harness = createHarness(ok)

    // when
    await harness.handle.startInitialPrompt("do the rpc child work")

    // then the outgoing prompt must never omit streamingBehavior: an omitted field is
    // exactly what makes a streaming child answer with BUSY_CHILD_REJECTION.
    const prompts = commandsOfType(harness.sent, "prompt")
    expect(prompts).toHaveLength(1)
    expect(prompts[0]?.streamingBehavior).toBe("steer")
    await harness.handle.dispose()
  })

  test("#given a host that rejects the steer command as busy #when task_send steers #then delivery falls back to followUp instead of failing hard", async () => {
    // given a child that refuses `steer` with the busy-agent rejection
    const harness = createHarness((command) => (command.type === "steer" ? busy(command) : ok(command)))

    // when
    await harness.handle.steer("steer: keep going")

    // then the rejection is absorbed by a followUp retry, never surfaced as a hard failure
    const followUps = commandsOfType(harness.sent, "prompt").filter((c) => c.streamingBehavior === "followUp")
    expect(followUps).toHaveLength(1)
    expect(followUps[0]?.message).toBe("steer: keep going")
    await harness.handle.dispose()
  })

  test("#given a host that rejects a queued prompt as busy #when the initial prompt is delivered #then the followUp fallback keeps the child alive", async () => {
    // given a child that refuses the steer-flavored prompt but accepts followUp
    const harness = createHarness((command) =>
      (command as SentCommand).streamingBehavior === "steer" ? busy(command) : ok(command),
    )

    // when
    await harness.handle.startInitialPrompt("do the rpc child work")

    // then the delivery retried as followUp rather than throwing the child into exit 1
    const prompts = commandsOfType(harness.sent, "prompt")
    expect(prompts.map((command) => command.streamingBehavior)).toEqual(["steer", "followUp"])
    await harness.handle.dispose()
  })
})
