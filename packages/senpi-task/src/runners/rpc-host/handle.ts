import { log } from "@oh-my-opencode/utils"

import type { RunnerOutcome } from "../in-process/child-handle"
import { isBusyChildRejection, type RpcStreamingBehavior } from "../rpc/delivery-semantics"
import { agentEndOutcome, exitTurnOutcome, extractAssistantText, promptFailureOutcome } from "../rpc/turn-outcome"
import type { ChildEventListener, ChildExitOutcome, RpcTerminalAssistantMessage } from "../types"
import {
  classifySessionExit,
  type SessionCloseIntent,
  type SessionExitCause,
  type SessionExitClassification,
} from "./exit-mapping"
import type { HostSessionChildHandle, HostSessionHandleOptions } from "./handle-port"
import type { HostSessionParked } from "./session-client"

/** How long `terminate()` waits for the host to acknowledge the abort before closing anyway. */
const ABORT_GRACE_MS = 2_000

/**
 * The steerable child handle over ONE daemon session: identical turn semantics to
 * `runners/rpc/handle.ts` (steer with followUp fallback, agent_end outcome tracking, idle/outcome
 * waiters, get_state heartbeat), with process facts replaced by session facts. `pid` is ALWAYS
 * undefined - the daemon's pid belongs to no child - and nothing here signals a process:
 * `terminate()` is `abort` then `close_session`, both bounded.
 */
export function createHostSessionHandle(options: HostSessionHandleOptions): HostSessionChildHandle {
  const { client, session, taskId, heartbeatIntervalMs, now, closeGraceMs } = options
  const idleWaiters: Array<() => void> = []
  const outcomeWaiters: Array<(settled: RunnerOutcome) => void> = []
  const exitWaiters: Array<(outcome: ChildExitOutcome) => void> = []
  const parkedListeners = new Set<(event: HostSessionParked) => void>()
  let reachedIdle = false
  let sessionId: string | undefined
  let finalText: string | undefined
  let turnBaseline: string | undefined
  let turnOutcome: RunnerOutcome | undefined
  let terminalAssistantMessage: RpcTerminalAssistantMessage | undefined
  let abortedByUser = false
  let lastSeenAt: number | undefined
  let outcome: ChildExitOutcome | undefined
  let intent: SessionCloseIntent = "running"
  let parked = false
  let detached = false

  const settleTurn = (settled: RunnerOutcome): void => {
    if (turnOutcome !== undefined) return
    turnOutcome = settled
    reachedIdle = true
    flush(idleWaiters)
    for (const waiter of outcomeWaiters.splice(0)) waiter(settled)
  }

  client.onEvent((event) => {
    if (event.type === "message_end") {
      const terminal = extractTerminalAssistantMessage(event.message)
      if (terminal !== undefined) {
        terminalAssistantMessage = terminal
        finalText = terminal.text ?? finalText
      }
    }
    if (event.type === "agent_end" && event.willRetry === false) {
      settleTurn(abortedByUser ? { status: "cancelled" } : agentEndOutcome(event, turnBaseline, finalText))
    }
  })

  const heartbeat = setInterval(() => {
    if (outcome !== undefined || parked || detached) return
    // `SessionClient.getState` throws in place - it does not return a rejected promise - once the
    // connection is gone, and teardown can detach the client before `settleExit` stops this beat.
    // A throw escaping the timer callback is an uncaughtException that takes the whole host down,
    // so the sync throw is caught here and the rejection path is logged below.
    try {
      client
        .getState()
        .then((state) => {
          lastSeenAt = now()
          sessionId = state.sessionId
        })
        .catch((error: unknown) => {
          log("senpi-task host session heartbeat get_state failed", { taskId, error: String(error) })
        })
    } catch (error) {
      log("senpi-task host session heartbeat get_state failed", { taskId, error: String(error) })
    }
  }, heartbeatIntervalMs)
  heartbeat.unref?.()

  const settleExit = (built: ChildExitOutcome): void => {
    if (outcome) return
    outcome = built
    clearInterval(heartbeat)
    flush(idleWaiters)
    if (turnOutcome === undefined) settleTurn(exitTurnOutcome(built, finalText))
    for (const waiter of exitWaiters.splice(0)) waiter(built)
  }

  // A parked session is NOT an exit: the child keeps its status and its transcript, and the manager
  // parks the record (`rpc_detached`) until a later turn reopens the session from its JSONL.
  const park = (event: HostSessionParked): void => {
    parked = true
    clearInterval(heartbeat)
    for (const listener of parkedListeners) listener(event)
  }

  const settleClassified = (classified: SessionExitClassification): void => {
    switch (classified.disposition) {
      case "exit":
        return settleExit(classified.outcome)
      case "parked":
        return park({ sessionId: session.routingId, sessionPath: session.sessionPath })
      default:
        return unreachable(classified)
    }
  }

  /**
   * A session that ends while this child still holds it is the child's exit. Once the session was
   * parked or this client detached, nothing the host says afterwards is this child's death.
   */
  const endSession = (cause: SessionExitCause): void => {
    if (parked || detached || outcome !== undefined) return
    settleClassified(classifySessionExit({ cause, intent }))
  }

  client.onParked((event) => {
    if (parked || detached || outcome !== undefined) return
    park(event)
  })
  client.onClosed((event) => endSession({ kind: "session_closed", reason: event.reason }))
  void client.transportGone.then(() => endSession({ kind: "transport_gone" }))

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

  // Same queueing contract as the child-process runner: a delivery that lands mid-run is retried
  // as followUp instead of failing the child (`rpc/delivery-semantics.ts`).
  const deliverPrompt = async (text: string, streamingBehavior: RpcStreamingBehavior): Promise<void> => {
    try {
      await client.send({ type: "prompt", message: text, streamingBehavior })
    } catch (error) {
      if (streamingBehavior === "followUp" || !isBusyChildRejection(error)) throw error
      await client.send({ type: "prompt", message: text, streamingBehavior: "followUp" })
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

  const bestEffort = (work: Promise<void>, step: string): Promise<void> =>
    work.catch((error: unknown) => {
      log("senpi-task host session teardown step failed", { taskId, step, error: String(error) })
    })

  // Bounded teardown: a daemon that never answers must not hold the parent's shutdown open, and a
  // session is never ended with a signal.
  const endOnHost = async (next: "closed" | "terminated"): Promise<void> => {
    if (outcome !== undefined) return
    intent = next
    // `client.close()` drops the connection before the classification below stops the beat; stop
    // it up front so no tick lands on a client this teardown has already detached.
    clearInterval(heartbeat)
    if (next === "terminated") await settleWithin(bestEffort(client.send({ type: "abort" }), "abort"), ABORT_GRACE_MS)
    await settleWithin(bestEffort(client.close(), "close_session"), closeGraceMs)
    // A teardown this client asked for always ends the child - including a session the daemon had
    // parked, which the manager cancels exactly the same way.
    const reason = next === "terminated" ? "terminated" : "client_close"
    settleClassified(classifySessionExit({ cause: { kind: "session_closed", reason }, intent }))
  }

  const detach = async (): Promise<void> => {
    detached = true
    clearInterval(heartbeat)
    await client.detach()
  }

  return {
    task_id: taskId,
    kind: "host-session",
    hostSession: { socket: client.socketPath, ...session },
    get sessionId() {
      return sessionId
    },
    pid: undefined,
    get attached() {
      return outcome === undefined && !parked && !detached
    },
    steer: async (text) => {
      beginTurn()
      try {
        await client.send({ type: "steer", message: text })
      } catch (error) {
        if (!isBusyChildRejection(error)) throw error
        await deliverPrompt(text, "followUp")
      }
    },
    followUp: (text) => runPrompt(text, "followUp"),
    abort: () => {
      abortedByUser = true
      return client.send({ type: "abort" })
    },
    subscribe: (listener: ChildEventListener) => client.onEvent(listener),
    onParked: (listener) => {
      parkedListeners.add(listener)
      return () => parkedListeners.delete(listener)
    },
    waitForIdle: () =>
      reachedIdle || outcome ? Promise.resolve() : new Promise<void>((resolve) => idleWaiters.push(resolve)),
    hasExited: () => outcome !== undefined,
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
    waitForExit: () =>
      outcome ? Promise.resolve(outcome) : new Promise<ChildExitOutcome>((resolve) => exitWaiters.push(resolve)),
    dispose: detach,
    detach,
    close: () => endOnHost("closed"),
    terminate: () => endOnHost("terminated"),
    startInitialPrompt: (text) => runPrompt(text),
  }
}

/** Resolve when the work settles or the budget expires, whichever comes first. */
function settleWithin(work: Promise<void>, budgetMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, budgetMs)
    timer.unref?.()
    void work.then(() => {
      clearTimeout(timer)
      resolve()
    })
  })
}

function flush(waiters: Array<() => void>): void {
  for (const waiter of waiters.splice(0)) waiter()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function extractTerminalAssistantMessage(message: unknown): RpcTerminalAssistantMessage | undefined {
  if (!isRecord(message)) return undefined
  const record = message
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

function unreachable(value: never): never {
  throw new Error(`unhandled session exit classification: ${JSON.stringify(value)}`)
}
