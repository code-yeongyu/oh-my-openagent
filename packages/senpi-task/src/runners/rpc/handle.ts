import type { ChildProcess } from "node:child_process"
import type { RpcResponse, RpcSessionState } from "@code-yeongyu/senpi"
import { log } from "@oh-my-opencode/utils"

import type { RunnerOutcome } from "../in-process/child-handle"
import type {
  ChildEventListener,
  ChildExitOutcome,
  RpcChildHandle,
  RpcTerminalAssistantMessage,
  TerminateOptions,
} from "../types"
import { type RpcStreamingBehavior, isBusyChildRejection } from "./delivery-semantics"
import { RpcCommandError } from "./errors"
import { recordTaskChildDeath } from "./crash-record"
import { classifyChildExit } from "./exit-mapping"
import { createHandleListeners } from "../rpc-host/handle-listeners"
import { isHarmlessRpcShutdownError, type RpcProtocolClient } from "./protocol-client"
import { terminateRpcChild } from "./terminate"
import { exitTurnOutcome, extractAssistantText, promptFailureOutcome } from "./turn-outcome"
import { createTurnSettlement, sessionIsIdle } from "./turn-settlement"

export type CreateRpcChildHandleOptions = {
  readonly client: RpcProtocolClient
  readonly child: ChildProcess
  readonly taskId: string
  readonly heartbeatIntervalMs: number
  readonly now: () => number
  /** The child's spawn env: where it keeps its agent dir, so its unexpected death is recorded there. */
  readonly childEnv?: NodeJS.ProcessEnv
  /** Stops the child process; defaults to terminateRpcChild. A test passes a fake so it never signals a host process. */
  readonly terminateChild?: (child: ChildProcess, options?: TerminateOptions) => Promise<void>
}

export type TrackedRpcChildHandle = RpcChildHandle & {
  startInitialPrompt(text: string): Promise<void>
}

/**
 * Assemble the steerable RpcChildHandle over a protocol client: steer/followUp/
 * abort mapping, event fan-out, idle + exit awaiting, final-text tracking, and
 * a get_state liveness heartbeat (records lastSeen only). terminate() delegates
 * to the single-writer terminate module.
 */
export function createRpcChildHandle(options: CreateRpcChildHandleOptions): TrackedRpcChildHandle {
  const { client, child, taskId, heartbeatIntervalMs, now } = options
  const idleWaiters: Array<() => void> = []
  const outcomeWaiters: Array<(settled: RunnerOutcome) => void> = []
  const exitWaiters: Array<(outcome: ChildExitOutcome) => void> = []
  let reachedIdle = false
  let sessionId: string | undefined
  let finalText: string | undefined
  let turnBaseline: string | undefined
  let turnOutcome: RunnerOutcome | undefined
  let terminalAssistantMessage: RpcTerminalAssistantMessage | undefined
  let abortedByUser = false
  let lastSeenAt: number | undefined
  let outcome: ChildExitOutcome | undefined
  let terminationRequested = false
  // Wall clock on purpose: the injected `now` is the heartbeat's clock, and tests observe its calls.
  const startedAt = Date.now()

  const settleTurn = (settled: RunnerOutcome): void => {
    if (turnOutcome !== undefined) return
    turnOutcome = settled
    reachedIdle = true
    flush(idleWaiters)
    for (const waiter of outcomeWaiters.splice(0)) waiter(settled)
  }

  const settlement = createTurnSettlement({
    settle: settleTurn,
    abortedByUser: () => abortedByUser,
    baseline: () => turnBaseline,
    finalText: () => finalText,
  })

  const resumedListeners = new Set<() => void>()
  // A child can run its whole first turn (a tool call and an in-session fallback hop included) before
  // `start` returns and the manager subscribes; those events are kept for the first observers (#9582).
  const listeners = createHandleListeners({
    onListenerError: (error) => log("senpi-task rpc child event listener failed", { taskId, error: String(error) }),
  })
  client.onEvent((event) => {
    // A run the child starts on its own after its turn settled (a monitor or background job woke it)
    // is a new turn: the next outcome is that run's, never the settled one again (omo#9069).
    if (event.type === "agent_start" && turnOutcome !== undefined && outcome === undefined) {
      beginTurn()
      for (const listener of resumedListeners) listener()
    }
    if (event.type === "message_end") {
      const terminal = extractTerminalAssistantMessage(event.message)
      if (terminal !== undefined) {
        terminalAssistantMessage = terminal
        finalText = terminal.text ?? finalText
      }
    }
    settlement.observe(event)
  })
  // Subscribers run after the handle has recorded the event (as on dev, and as the host handle does), so a
  // live observer reads current state and one that throws cannot keep the handle from settling a turn.
  client.onEvent((event) => listeners.emitEvent(event))

  const heartbeat = setInterval(() => {
    if (client.exited || child.stdin?.writableEnded || child.stdin?.destroyed) return
    try {
      client
        .send({ type: "get_state" })
        .then((response) => {
          lastSeenAt = now()
          sessionId = readSessionId(response) ?? sessionId
        })
        .catch((error: unknown) => {
          if (client.exited || isHarmlessRpcShutdownError(error)) return
          log("senpi-task heartbeat get_state failed", { taskId, error: String(error) })
        })
    } catch (error) {
      if (client.exited || isHarmlessRpcShutdownError(error)) return
      log("senpi-task heartbeat get_state failed", { taskId, error: String(error) })
    }
  }, heartbeatIntervalMs)
  heartbeat.unref?.()

  const settleExit = (built: ChildExitOutcome): void => {
    if (outcome) {
      return
    }
    outcome = built
    clearInterval(heartbeat)
    flush(idleWaiters)
    if (turnOutcome === undefined) settleTurn(settlement.pending() ?? exitTurnOutcome(built, finalText))
    for (const waiter of exitWaiters.splice(0)) {
      waiter(built)
    }
  }

  child.once("error", (error) => settleExit(classifyChildExit({ code: null, signal: null, error, pid: child.pid, stderr: client.stderrTail })))
  child.once("close", (code, signal) => {
    const built = classifyChildExit({ code, signal, pid: child.pid, stderr: client.stderrTail, terminatedByRunner: terminationRequested })
    if (options.childEnv !== undefined) {
      recordTaskChildDeath({ env: options.childEnv, outcome: built, terminationRequested, startedAt, now: Date.now() })
    }
    settleExit(built)
  })

  const runCommand = async (command: Parameters<RpcProtocolClient["send"]>[0], label: string): Promise<void> => {
    const response = await client.send(command)
    assertOk(response, label)
  }

  const beginTurn = (): void => {
    if (outcome !== undefined) return
    if (reachedIdle || turnOutcome !== undefined) {
      reachedIdle = false
      turnOutcome = undefined
    }
    terminalAssistantMessage = undefined
    abortedByUser = false
    turnBaseline = finalText
  }

  // Deliver with explicit queueing semantics, retrying as followUp when the child answers
  // "busy". Without this a mid-run delivery is rejected outright and aborts the child.
  const deliverPrompt = async (text: string, streamingBehavior: RpcStreamingBehavior): Promise<void> => {
    try {
      await runCommand({ type: "prompt", message: text, streamingBehavior }, "prompt")
    } catch (error) {
      if (streamingBehavior === "followUp" || !isBusyChildRejection(error)) throw error
      await runCommand({ type: "prompt", message: text, streamingBehavior: "followUp" }, "prompt")
    }
  }

  const runPrompt = async (text: string, streamingBehavior: RpcStreamingBehavior = "steer"): Promise<void> => {
    beginTurn()
    try {
      await deliverPrompt(text, streamingBehavior)
    } catch (error) {
      settleTurn(promptFailureOutcome(error))
      throw error
    }
  }

  return {
    task_id: taskId,
    get sessionId() {
      return sessionId
    },
    get pid() {
      return child.pid ?? undefined
    },
    // task_send is documented to ALWAYS steer into the addressed child, so a steer that the
    // host rejects as busy degrades to followUp queueing rather than failing the delivery.
    steer: async (text) => {
      beginTurn()
      try {
        await runCommand({ type: "steer", message: text }, "steer")
      } catch (error) {
        if (!isBusyChildRejection(error)) throw error
        await deliverPrompt(text, "followUp")
      }
    },
    followUp: (text) => runPrompt(text, "followUp"),
    abort: () => {
      abortedByUser = true
      return runCommand({ type: "abort" }, "abort")
    },
    subscribe: (listener: ChildEventListener) => {
      const unsubscribe = listeners.registrations.subscribe(listener)
      return () => void unsubscribe()
    },
    subscribeExtensionEvents: client.extensionEvents.subscribe,
    adoptFinishedTurn: async (finalResponse) => {
      if (turnOutcome !== undefined || settlement.pending() !== undefined) return
      const response = await client.send({ type: "get_state" }).catch(() => undefined)
      if (response === undefined || response.command !== "get_state" || !response.success || !sessionIsIdle(response.data)) return
      if (turnOutcome === undefined && settlement.pending() === undefined) settleTurn({ status: "completed", finalResponse })
    },
    onSelfResumed: (listener) => {
      resumedListeners.add(listener)
      return () => resumedListeners.delete(listener)
    },
    waitForIdle: () =>
      reachedIdle || outcome ? Promise.resolve() : new Promise<void>((resolve) => idleWaiters.push(resolve)),
    hasExited: () => client.exited,
    waitForOutcome: () =>
      turnOutcome !== undefined
        ? Promise.resolve(turnOutcome)
        : outcome === undefined
          ? new Promise<RunnerOutcome>((resolve) => outcomeWaiters.push(resolve))
          : Promise.resolve(exitTurnOutcome(outcome, finalText)),
    lastAssistantText: () => finalText,
    terminalAssistantMessage: () => terminalAssistantMessage,
    wasAbortedByUser: () => abortedByUser,
    lastSeen: () => lastSeenAt,
    exitOutcome: () => outcome,
    waitForExit: () => (outcome ? Promise.resolve(outcome) : new Promise<ChildExitOutcome>((resolve) => exitWaiters.push(resolve))),
    dispose: async () => {
      clearInterval(heartbeat)
      listeners.clearActive()
      try {
        await client.detach()
      } catch (error) {
        log("senpi-task rpc detach failed", { taskId, error: String(error) })
      }
    },
    terminate: (terminateOptions?: TerminateOptions) => {
      terminationRequested = true
      return (options.terminateChild ?? terminateRpcChild)(child, terminateOptions)
    },
    startInitialPrompt: (text) => runPrompt(text),
  }
}

function flush(waiters: Array<() => void>): void {
  for (const waiter of waiters.splice(0)) {
    waiter()
  }
}

function assertOk(response: RpcResponse, label: string): void {
  if (!response.success) {
    throw new RpcCommandError(label, response.error)
  }
}

function readSessionId(response: RpcResponse): string | undefined {
  if (response.command !== "get_state" || !response.success) {
    return undefined
  }
  const state: RpcSessionState = response.data
  return state.sessionId
}

function extractTerminalAssistantMessage(message: unknown): RpcTerminalAssistantMessage | undefined {
  if (typeof message !== "object" || message === null) return undefined
  const record = message as Record<string, unknown>
  if (record.role !== "assistant") return undefined
  const text = extractAssistantText(record)
  const stopReason = typeof record.stopReason === "string" ? record.stopReason : undefined
  const errorMessage = typeof record.errorMessage === "string" ? record.errorMessage : undefined
  return {
    ...(text === undefined ? {} : { text }),
    ...(stopReason === undefined ? {} : { stopReason }),
    ...(errorMessage === undefined ? {} : { errorMessage }),
  }
}
