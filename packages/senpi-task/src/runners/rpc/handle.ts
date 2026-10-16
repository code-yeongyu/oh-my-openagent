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
import { RpcCommandError, RpcRequestTimeout } from "./errors"
import { startHeartbeat, unresponsiveMessage } from "./heartbeat"
import { recordTaskChildDeath } from "./crash-record"
import { classifyChildExit } from "./exit-mapping"
import { createHandleListeners } from "../rpc-host/handle-listeners"
import { isHarmlessRpcShutdownError, type RpcProtocolClient } from "./protocol-client"
import { terminateRpcChild } from "./terminate"
import { exitTurnOutcome, extractAssistantText, promptFailureOutcome } from "./turn-outcome"
import { createTurnSettlement, sessionIsIdle, type TurnSettlementScheduler } from "./turn-settlement"
import { createTurnWakeSources } from "./turn-wake-sources"
import { createInputEffects } from "../input-effects"
import { createInputDelivery } from "../input-delivery"

export type CreateRpcChildHandleOptions = {
  readonly inputStore?: import("../../store").TaskRecordStore
  readonly client: RpcProtocolClient
  readonly child: ChildProcess
  readonly taskId: string
  readonly heartbeatIntervalMs: number
  readonly now: () => number
  /** The child's spawn env: where it keeps its agent dir, so its unexpected death is recorded there. */
  readonly childEnv?: NodeJS.ProcessEnv
  /** Stops the child process; defaults to terminateRpcChild. A test passes a fake so it never signals a host process. */
  readonly terminateChild?: (child: ChildProcess, options?: TerminateOptions) => Promise<void>
  /** Test seam: drives the settle confirmation by hand instead of a real timer. */
  readonly settlementScheduler?: TurnSettlementScheduler
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
  let tornDown = false
  // Wall clock on purpose: the injected `now` is the heartbeat's clock, and tests observe its calls.
  const startedAt = Date.now()

  const settleTurn = (settled: RunnerOutcome): void => {
    if (turnOutcome !== undefined) return
    turnOutcome = settled
    reachedIdle = true
    flush(idleWaiters)
    for (const waiter of outcomeWaiters.splice(0)) waiter(settled)
  }

  const wakeSources = createTurnWakeSources()
  const settlement = createTurnSettlement({
    settle: settleTurn,
    abortedByUser: () => abortedByUser,
    baseline: () => turnBaseline,
    finalText: () => finalText,
    probe: async () => {
      const response = await client.send({ type: "get_state" })
      // A non-success reply is unreadable state, not a busy session: the settlement bounds its re-arms.
      return response.success === true && response.command === "get_state" ? (response.data as object) : undefined
    },
    settleConfirmMs: heartbeatIntervalMs,
    wakeSourcesLive: () => wakeSources.hasLiveWakeSources(),
    disposed: () => tornDown,
    scheduleConfirmation: options.settlementScheduler,
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
    // Goal/monitor wake records ride the SAME stream as agent events here: the protocol client
    // only diverts permission-shaped extension events, so a raw `extension_event` reaches this
    // funnel. The tracker reads `name`; a record that names nothing it tracks is ignored.
    if ((event as { readonly type?: string }).type === "extension_event") {
      wakeSources.observe(event)
      settlement.reconfirmHeld()
    }
  })
  // Subscribers run after the handle has recorded the event (as on dev, and as the host handle does), so a
  // live observer reads current state and one that throws cannot keep the handle from settling a turn.
  client.onEvent((event) => listeners.emitEvent(event))

  const stopHeartbeat = startHeartbeat({
    intervalMs: heartbeatIntervalMs,
    paused: () => outcome !== undefined || client.exited || child.stdin?.writableEnded === true || child.stdin?.destroyed === true,
    probe: async () => {
      const response = await client.send({ type: "get_state" })
      assertOk(response, "get_state")
      return response
    },
    onState: (response) => {
      lastSeenAt = now()
      sessionId = readSessionId(response) ?? sessionId
    },
    onFailure: (error) => {
      if (!isHarmlessRpcShutdownError(error)) log("senpi-task heartbeat get_state failed", { taskId, error: String(error) })
    },
    onUnresponsive: () => {
      settleTurn({ status: "error", failure: { kind: "child-unresponsive", message: unresponsiveMessage(taskId) } })
      settleExit({ kind: "crashed", facts: { pid: child.pid, code: null, signal: null, stderrTail: "child-unresponsive" } })
      terminationRequested = true
      void (options.terminateChild ?? terminateRpcChild)(child).catch((error: unknown) => {
        log("senpi-task unresponsive child termination failed", { taskId, error: String(error) })
      })
    },
  })

  const settleExit = (built: ChildExitOutcome): void => {
    if (outcome) {
      return
    }
    outcome = built
    stopHeartbeat()
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

  const writeCommand = async (command: Parameters<RpcProtocolClient["send"]>[0], label: string): Promise<void> => {
    const response = await client.send(command)
    assertOk(response, label)
  }
  const inputEffects = createInputEffects({
    taskId, store: options.inputStore,
    send: command => writeCommand(command, command.type),
  })

  const beginTurn = (): void => {
    if (outcome !== undefined) return
    if (reachedIdle || turnOutcome !== undefined) {
      reachedIdle = false
      turnOutcome = undefined
    }
    terminalAssistantMessage = undefined
    abortedByUser = false
    turnBaseline = finalText
    wakeSources.resetTurn()
  }

  const delivery = createInputDelivery({
    effects: inputEffects, beginTurn, promptFailed: error => {
      // A broken pipe can reject the command before close supplies the process-exit facts.
      // Let close settle that outcome so the manager can confirm it instead of publishing ERROR.
      if (!client.exited && !(error instanceof RpcRequestTimeout)) settleTurn(promptFailureOutcome(error))
    },
  })

  return {
    reconcileInputs: inputEffects.reconcile,
    task_id: taskId,
    get sessionId() {
      return sessionId
    },
    get pid() {
      return child.pid ?? undefined
    },
    // task_send is documented to ALWAYS steer into the addressed child, so a steer that the
    // host rejects as busy degrades to followUp queueing rather than failing the delivery.
    steer: delivery.steer,
    followUp: (text) => delivery.runPrompt(text, "followUp"),
    abort: () => {
      abortedByUser = true
      return writeCommand({ type: "abort" }, "abort")
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
    hasExited: () => outcome !== undefined || client.exited,
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
      inputEffects.stopRetrying()
      tornDown = true
      stopHeartbeat()
      settlement.cancelConfirmation()
      listeners.clearActive()
      try {
        await client.detach()
      } catch (error) {
        log("senpi-task rpc detach failed", { taskId, error: String(error) })
      }
    },
    terminate: (terminateOptions?: TerminateOptions) => {
      inputEffects.stopRetrying()
      terminationRequested = true
      return (options.terminateChild ?? terminateRpcChild)(child, terminateOptions)
    },
    startInitialPrompt: (text) => delivery.runPrompt(text),
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
