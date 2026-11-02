import type { ChildProcess } from "node:child_process"
import { EventEmitter } from "node:events"
import type { AgentSessionEvent } from "@code-yeongyu/senpi"
import { describe, expect, it } from "bun:test"

import type { RunnerOutcome } from "../in-process/child-handle"
import { createRpcChildHandle } from "./handle"
import type { RpcProtocolClient } from "./protocol-client"
import { createChildExtensionEvents } from "../child-extension-events"

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
    extensionEvents: createChildExtensionEvents(),
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
      harness.emit(event({ type: "agent_idle" }))
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
      harness.emit(event({ type: "agent_idle" }))
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
      harness.emit(event({ type: "agent_idle" }))
      expect((await harness.handle.waitForOutcome()).status).toBe("cancelled")

      // when
      await harness.handle.followUp("second")
      harness.emit(event({
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop" },
      }))
      harness.emit(event({ type: "agent_end", willRetry: false, messages: [] }))
      harness.emit(event({ type: "agent_idle" }))
      const outcome = await harness.handle.waitForOutcome()

      // then
      expect(outcome).toEqual({ status: "completed", finalResponse: "done" })
      await harness.handle.dispose()
    })
  })
})

describe("rpc turn outcome foreign user abort classification (F10a)", () => {
  const PARTIAL_ANSWER = {
    role: "assistant",
    content: [{ type: "text", text: "partial answer before the foreign abort" }],
    stopReason: "aborted",
    errorMessage: "This operation was aborted",
  }

  describe("#given a turn another client's user abort ends", () => {
    it("#when the terminating agent_end arrives #then the tracked outcome is interrupted and keeps the partial text", async () => {
      // given
      const harness = createHarness()
      await harness.handle.startInitialPrompt("work")

      // when
      harness.emit(event({ type: "message_end", message: PARTIAL_ANSWER }))
      harness.emit(event({
        type: "agent_end",
        willRetry: false,
        aborted: true,
        abortSource: "user",
        abortedBy: "guest-client",
        messages: [PARTIAL_ANSWER],
      }))
      harness.emit(event({ type: "agent_idle" }))

      // then
      expect(await harness.handle.waitForOutcome()).toEqual({
        status: "interrupted",
        finalResponse: "partial answer before the foreign abort",
        abortedBy: "guest-client",
      })
      await harness.handle.dispose()
    })
  })

  describe("#given a turn this parent aborts first", () => {
    it("#when the host echoes the same user abortSource #then the tracked outcome stays cancelled", async () => {
      // given
      const harness = createHarness()
      await harness.handle.startInitialPrompt("work")

      // when
      await harness.handle.abort()
      harness.emit(event({
        type: "agent_end",
        willRetry: false,
        aborted: true,
        abortSource: "user",
        messages: [PARTIAL_ANSWER],
      }))
      harness.emit(event({ type: "agent_idle" }))

      // then
      expect(await harness.handle.waitForOutcome()).toEqual({ status: "cancelled" })
      await harness.handle.dispose()
    })
  })

  describe("#given a provider abort", () => {
    it("#when the terminating agent_end arrives #then the tracked outcome stays a turn failure", async () => {
      // given
      const harness = createHarness()
      await harness.handle.startInitialPrompt("work")

      // when
      harness.emit(event({
        type: "agent_end",
        willRetry: false,
        aborted: true,
        abortSource: "provider",
        messages: [PARTIAL_ANSWER],
      }))
      harness.emit(event({ type: "agent_idle" }))

      // then
      const outcome = await harness.handle.waitForOutcome()
      expect(outcome.status).toBe("error")
      expect(outcome.status === "error" ? outcome.failure.kind : undefined).toBe("child-turn-failed")
      await harness.handle.dispose()
    })
  })

  describe("#given an abort the child does not attribute", () => {
    it("#when the terminating agent_end arrives #then the tracked outcome keeps today's error classification", async () => {
      // given
      const harness = createHarness()
      await harness.handle.startInitialPrompt("work")

      // when
      harness.emit(event({ type: "agent_end", willRetry: false, aborted: true, messages: [] }))
      harness.emit(event({ type: "agent_idle" }))

      // then
      expect((await harness.handle.waitForOutcome()).status).toBe("error")
      await harness.handle.dispose()
    })
  })
})
