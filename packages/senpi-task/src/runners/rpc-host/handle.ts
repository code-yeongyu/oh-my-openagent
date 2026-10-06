import { log } from "@oh-my-opencode/utils"

import type { RunnerOutcome } from "../in-process/child-handle"
import { isBusyChildRejection, type RpcStreamingBehavior } from "../rpc/delivery-semantics"
import { exitTurnOutcome, promptFailureOutcome } from "../rpc/turn-outcome"
import { createTurnSettlement, sessionIsIdle } from "../rpc/turn-settlement"
import type { ChildEventListener, ChildExitOutcome, RpcTerminalAssistantMessage } from "../types"
import {
  classifySessionExit,
  type SessionCloseIntent,
  type SessionExitCause,
} from "./exit-mapping"
import { bindHostSessionPort } from "./handle-client-binding"
import { settleClassifiedSessionExit } from "./handle-exit"
import type {
  HostSessionChildHandle,
  HostSessionHandleOptions,
  HostSessionIdentity,
  HostSessionOpenDisposition,
  HostSessionPort,
} from "./handle-port"
import { startHostHeartbeat } from "./handle-heartbeat"
import { createHandleListeners } from "./handle-listeners"
import { createHandleRecovery } from "./handle-recovery"
import { createHandleStop } from "./handle-stop"
import { createHandleTeardown } from "./handle-teardown"
import { createHandleWaiters } from "./handle-waiters"
import { isTransportLossError } from "./reattach"
import type { HostSessionParked } from "./session-client"
import { extractTerminalAssistantMessage } from "./terminal-message"
import { isTransportRecoveryExpired } from "./transport-recovery"

/**
 * The steerable child handle over ONE daemon session: identical turn semantics to
 * `runners/rpc/handle.ts` (steer with followUp fallback, agent_end outcome tracking, idle/outcome
 * waiters, get_state heartbeat), with process facts replaced by session facts. `pid` is ALWAYS
 * undefined - the daemon's pid belongs to no child - and nothing here signals a process:
 * `terminate()` is `abort` then `close_session`, both bounded.
 */
export function createHostSessionHandle(options: HostSessionHandleOptions): HostSessionChildHandle {
  const { taskId, heartbeatIntervalMs, now, closeGraceMs, reattach, shardEvents, transportRecovery } = options
  // Both move on a reattach: a recovered transport is a new port, and a reopened session a new
  // routing handle on a possibly new host generation. The session PATH is the child's identity.
  let client: HostSessionPort = options.client
  let session: HostSessionIdentity = options.session
  let openDisposition: HostSessionOpenDisposition = options.openDisposition
  const listeners = createHandleListeners({
    onListenerError: (error) => log("senpi-task early event replay listener failed", { taskId, error: String(error) }),
  })
  const waiters = createHandleWaiters()
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
    waiters.settleTurn(settled)
  }

  const settlement = createTurnSettlement({
    settle: settleTurn,
    abortedByUser: () => abortedByUser,
    baseline: () => turnBaseline,
    finalText: () => finalText,
  })

  const onSessionEvent = (event: Parameters<ChildEventListener>[0]): void => {
    // A run the child starts on its own after its turn settled (a monitor or background job woke it)
    // is a new turn: the next outcome is that run's, never the settled one again (omo#9069).
    if (event.type === "agent_start" && turnOutcome !== undefined && outcome === undefined) {
      beginTurn()
      listeners.emitSelfResumed()
    }
    if (event.type === "message_end") {
      const terminal = extractTerminalAssistantMessage(event.message)
      if (terminal !== undefined) {
        terminalAssistantMessage = terminal
        finalText = terminal.text ?? finalText
      }
    }
    settlement.observe(event)
  }

  const stopHeartbeat = startHostHeartbeat({
    taskId,
    intervalMs: heartbeatIntervalMs,
    paused: () => outcome !== undefined || parked || detached,
    port: () => client,
    onState: (state) => {
      lastSeenAt = now()
      sessionId = state.sessionId
      // A refused admission may emit only message_end, with no agent_end/agent_idle.
      // The host's idle state confirms the observed error has no continuation owning it.
      if (settlement.pending()?.status === "error" && sessionIsIdle(state)) {
        settlement.observe({ type: "agent_idle" })
      }
    },
  })

  const settleExit = (built: ChildExitOutcome): void => {
    if (outcome) return
    outcome = built
    listeners.clearActive()
    stopHeartbeat()
    waiters.flushIdle()
    if (turnOutcome === undefined) settleTurn(settlement.pending() ?? exitTurnOutcome(built, finalText))
    waiters.settleExit(built)
  }

  // A parked session is NOT an exit: the child keeps its status and its transcript, and the manager
  // parks the record (`rpc_detached`) until a later turn reopens the session from its JSONL.
  const park = (event: HostSessionParked): void => {
    // A parked session is idle on the host: an outcome held for `agent_idle` is final (omo#9069).
    const held = settlement.pending()
    if (turnOutcome === undefined && held !== undefined) settleTurn(held)
    parked = true
    stopHeartbeat()
    listeners.emitParked(event)
  }

  const settleClassified = (classified: ReturnType<typeof classifySessionExit>): void => settleClassifiedSessionExit(classified, { session, exit: settleExit, park })

  /**
   * A session that ends while this child still holds it is the child's exit. Once the session was
   * parked or this client detached, nothing the host says afterwards is this child's death.
   */
  const endSession = (cause: SessionExitCause): void => {
    if (parked || detached || outcome !== undefined) return
    settleClassified(classifySessionExit({ cause, intent }))
  }

  const stop = createHandleStop({
    taskId, closeGraceMs, settleExit,
    port: () => client,
    exited: () => outcome !== undefined,
    detached: () => detached,
    recovering: () => recovery.recovering(),
    markAborted: () => { abortedByUser = true },
    intent: () => intent,
    settleClosed: () => settleClassified(classifySessionExit({ cause: { kind: "session_closed", reason: "client_close" }, intent })),
    waitForExit: () => waiters.waitForExit(outcome),
  })

  const recovery = createHandleRecovery({
    taskId,
    reattach,
    events: shardEvents,
    bound: transportRecovery,
    // A child being closed or terminated is stopping too: a session a late reattach reopens is ended.
    stopRequested: () => stop.requested() || intent !== "running",
    endOnHost: stop.endOnHost,
    stopUnreached: stop.stopUnreached,
    recoveryEnded: stop.recoveryEnded,
    port: () => client,
    identity: () => session,
    alive: () => intent === "running" && !parked && !detached && outcome === undefined,
    turnSettled: () => turnOutcome !== undefined || reachedIdle,
    adopt: (next) => {
      client = next.client
      session = next.session
      openDisposition = next.attached ? "attached" : "reopened"
      bindHostSessionPort(client, clientBinding)
    },
    turnResumed: () => listeners.emitTurnResumed(),
    endLost: () => endSession({ kind: "transport_gone" }),
    // The continuation that re-drives the in-flight turn was not delivered (omo#9093). A lost
    // transport is the next recovery's to handle; anything else fails the turn exactly like an
    // undelivered prompt, instead of escaping as an unhandled rejection.
    continuationFailed: (error) => {
      log("senpi-task host session reattach continuation failed", { taskId, error: String(error) })
      if (isTransportRecoveryExpired(error)) return stop.lostOnReopen()
      if (!isTransportLossError(error)) settleTurn(promptFailureOutcome(error))
    },
    park: (reason) => park({ sessionId: session.routingId, sessionPath: session.sessionPath, reason }),
  })

  const clientBinding = {
    currentPort: () => client,
    acceptsLifecycleEvent: () => !parked && !detached && outcome === undefined,
    onEvent: (event: Parameters<ChildEventListener>[0]) => { onSessionEvent(event); listeners.emitEvent(event) },
    onExtensionEvent: listeners.extensionEvents.publish,
    onParked: park,
    onClosed: (event: { readonly reason: string | undefined }) => endSession({ kind: "session_closed", reason: event.reason }),
    onTransportGone: recovery.onTransportGone,
  }

  bindHostSessionPort(client, clientBinding)

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
      await recovery.issue({ type: "prompt", message: text, streamingBehavior })
    } catch (error) {
      if (streamingBehavior === "followUp" || !isBusyChildRejection(error)) throw error
      await recovery.issue({ type: "prompt", message: text, streamingBehavior: "followUp" })
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

  const teardown = createHandleTeardown({
    taskId,
    closeGraceMs,
    port: () => client,
    exited: () => outcome !== undefined,
    intent: () => intent,
    markIntent: (next) => { intent = next },
    markDetached: () => { detached = true },
    clearActive: listeners.clearActive,
    stopHeartbeat,
    settle: settleClassified,
  })

  return {
    task_id: taskId,
    kind: "host-session",
    get hostSession() {
      return { socket: client.socketPath, ...session }
    },
    get sessionId() {
      return sessionId
    },
    pid: undefined,
    get attached() {
      return outcome === undefined && !parked && !detached
    },
    get openDisposition() {
      return openDisposition
    },
    getEntries: async (since) => (await recovery.currentPort()).getEntries(since),
    switchSession: async (sessionPath) => (await recovery.currentPort()).switchSession(sessionPath),
    steer: async (text) => {
      beginTurn()
      try {
        await recovery.issue({ type: "steer", message: text })
      } catch (error) {
        if (!isBusyChildRejection(error)) throw error
        await deliverPrompt(text, "followUp")
      }
    },
    followUp: (text) => runPrompt(text, "followUp"),
    // A child whose cancel is waiting on its lost connection is stopped by that cancel: an abort (a
    // parent shutting down suspends it) must not wait out the whole recovery for nothing.
    abort: () => {
      abortedByUser = true
      if (stop.requested() && recovery.recovering()) return Promise.resolve()
      return recovery.issue({ type: "abort" })
    },
    transportRecovering: () => recovery.recovering() && outcome === undefined,
    markStopping: stop.markStopping,
    stopWhenReachable: stop.stopWhenReachable,
    ...listeners.registrations,
    adoptFinishedTurn: async (finalResponse) => {
      if (turnOutcome !== undefined || settlement.pending() !== undefined) return
      // A state read that fails is not proof of idleness, and must never cost the reattach: stay busy.
      const state = await client.getState().catch(() => undefined)
      if (state === undefined || !sessionIsIdle(state)) return
      if (turnOutcome === undefined && settlement.pending() === undefined) settleTurn({ status: "completed", finalResponse })
    },
    waitForIdle: () => waiters.waitForIdle(reachedIdle || outcome !== undefined),
    hasExited: () => outcome !== undefined,
    waitForOutcome: () => waiters.waitForOutcome(turnOutcome, outcome, finalText),
    lastAssistantText: () => finalText,
    terminalAssistantMessage: () => terminalAssistantMessage,
    wasAbortedByUser: () => abortedByUser,
    lastSeen: () => lastSeenAt,
    exitOutcome: () => outcome,
    waitForExit: () => waiters.waitForExit(outcome),
    dispose: teardown.detach,
    detach: teardown.detach,
    close: teardown.close,
    terminate: teardown.terminate,
    startInitialPrompt: (text) => runPrompt(text),
  }
}
