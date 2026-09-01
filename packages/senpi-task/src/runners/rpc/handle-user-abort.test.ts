import type { ChildProcess } from "node:child_process"
import { EventEmitter } from "node:events"
import type { AgentSessionEvent } from "@code-yeongyu/senpi"
import { describe, expect, it } from "bun:test"

import type { RunnerOutcome } from "../in-process/child-handle"
import { createRpcChildHandle } from "./handle"
import type { RpcProtocolClient } from "./protocol-client"

type TrackedHandle = ReturnType<typeof createRpcChildHandle> & {
  waitForOutcome(): Promise<RunnerOutcome>
}

function createHarness(): {
  readonly handle: TrackedHandle
  readonly emit: (event: AgentSessionEvent) => void
} {
  const child = Object.assign(new EventEmitter(), { pid: 4243 }) as unknown as ChildProcess
  const listeners = new Set<(event: AgentSessionEvent) => void>()
  const client = {
    stderrTail: "",
    send: () => Promise.resolve({ success: true }),
    onEvent: (listener: (event: AgentSessionEvent) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    detach: () => listeners.clear(),
  } as unknown as RpcProtocolClient
  const handle = createRpcChildHandle({ client, child, taskId: "st_abort_seam", heartbeatIntervalMs: 60_000, now: () => 1 }) as TrackedHandle
  return {
    handle,
    emit: (event) => {
      for (const listener of listeners) listener(event)
    },
  }
}

function event(value: unknown): AgentSessionEvent {
  return value as AgentSessionEvent
}

describe("rpc turn outcome user abort classification", () => {
  describe("#given a running turn the user explicitly aborts", () => {
    it("#when the terminating agent_end arrives #then the tracked outcome is cancelled", async () => {
      // given
      const harness = createHarness()
      await harness.handle.startInitialPrompt("work")

      // when
      await harness.handle.abort()
      harness.emit(event({ type: "agent_end", willRetry: false, messages: [] }))
      const outcome = await harness.handle.waitForOutcome()

      // then
      expect(outcome.status).toBe("cancelled")
      await harness.handle.dispose()
    })
  })

  describe("#given a turn that ends in a provider error without a user abort", () => {
    it("#when the terminating agent_end arrives #then the tracked outcome stays a turn failure", async () => {
      // given
      const harness = createHarness()
      await harness.handle.startInitialPrompt("work")

      // when
      harness.emit(event({
        type: "message_end",
        message: { role: "assistant", content: [], stopReason: "error", errorMessage: "provider exploded" },
      }))
      harness.emit(event({ type: "agent_end", willRetry: false, messages: [] }))
      const outcome = await harness.handle.waitForOutcome()

      // then
      expect(outcome.status).toBe("error")
      expect(outcome.status === "error" ? outcome.failure.kind : undefined).toBe("child-turn-failed")
      await harness.handle.dispose()
    })
  })

  describe("#given an aborted turn followed by a fresh prompt", () => {
    it("#when the new turn ends normally #then the stale abort no longer cancels it", async () => {
      // given
      const harness = createHarness()
      await harness.handle.startInitialPrompt("work")
      await harness.handle.abort()
      harness.emit(event({ type: "agent_end", willRetry: false, messages: [] }))
      expect((await harness.handle.waitForOutcome()).status).toBe("cancelled")

      // when
      await harness.handle.followUp("second")
      harness.emit(event({
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop" },
      }))
      harness.emit(event({ type: "agent_end", willRetry: false, messages: [] }))
      const outcome = await harness.handle.waitForOutcome()

      // then
      expect(outcome).toEqual({ status: "completed", finalResponse: "done" })
      await harness.handle.dispose()
    })
  })
})
