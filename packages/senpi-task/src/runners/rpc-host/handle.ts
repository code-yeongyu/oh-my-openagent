import { log } from "@oh-my-opencode/utils"

import type { RunnerOutcome } from "../in-process/child-handle"
import { exitTurnOutcome, promptFailureOutcome } from "../rpc/turn-outcome"
import { createTurnSettlement, sessionIsIdle } from "../rpc/turn-settlement"
import { createTurnWakeSources } from "../rpc/turn-wake-sources"
import type { ChildEventListener, ChildExitOutcome, RpcTerminalAssistantMessage } from "../types"
import { classifySessionExit, type SessionCloseIntent, type SessionExitCause } from "./exit-mapping"
import { bindHostSessionPort } from "./handle-client-binding"
import { settleClassifiedSessionExit } from "./handle-exit"
import type {
  HostSessionChildHandle,
  HostSessionHandleOptions,
  HostSessionOpenDisposition,
  HostSessionPort,
} from "./handle-port"
import { startHostHeartbeat } from "./handle-heartbeat"
import { unresponsiveMessage } from "../rpc/heartbeat"
import { createHandleListeners } from "./handle-listeners"
import { createHandleRecovery } from "./handle-recovery"
import { createHandleSessionIdentity } from "./handle-session-identity"
import { createHandleReconciliation } from "./handle-reconciliation"
import { createHandleStop } from "./handle-stop"
import { createHandleTeardown } from "./handle-teardown"
import { createHandleWaiters } from "./handle-waiters"
import type { HostSessionParked, HostSessionReplaced } from "./session-client"
import { extractTerminalAssistantMessage } from "./terminal-message"
import { createInputEffects } from "../input-effects"
import { toHostInput } from "./input-command"
import { createInputDelivery } from "../input-delivery"

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
  const identity = createHandleSessionIdentity(options.session)
  let openDisposition: HostSessionOpenDisposition = options.openDisposition
  const listeners = createHandleListeners({
    onListenerError: (error) => log("senpi-task early event replay listener failed", { taskId, error: String(error) }),
  })
  const waiters = createHandleWaiters()
  let reachedIdle = false
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
  let tornDown = false

  const settleTurn = (settled: RunnerOutcome): void => {
    if (turnOutcome !== undefined) return
    turnOutcome = settled
    reachedIdle = true
    waiters.settleTurn(settled)
  }

  const wakeSources = createTurnWakeSources()
  const settlement = createTurnSettlement({
    settle: settleTurn,
    abortedByUser: () => abortedByUser,
    baseline: () => turnBaseline,
    finalText: () => finalText,
    probe: () => client.getState(),
    settleConfirmMs: heartbeatIntervalMs,
    wakeSourcesLive: () => wakeSources.hasLiveWakeSources(),
    disposed: () => tornDown,
  })
  let continuationState: "none" | "pending_delivery" | "awaiting_start" = "none"
  const reconciliation = createHandleReconciliation({
    lastInputId: () => options.inputStore?.load(taskId)?.last_effect_id,
    port: () => client,
    settle: (settled) => {
      if (settled.status === "completed") finalText = settled.finalResponse
      settleTurn(settled)
    },
    continuing: () => { continuationState = "pending_delivery" },
  })

  const onSessionEvent = (event: Parameters<ChildEventListener>[0]): void => {
    // A run the child starts on its own after its turn settled (a monitor or background job woke it)
    // is a new turn: the next outcome is that run's, never the settled one again (omo#9069).
    if (event.type === "agent_start" && (continuationState === "awaiting_start" || turnOutcome !== undefined) && outcome === undefined) {
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
    // The host's loose boundary parse fans every tagged record - raw `extension_event` records
    // included - into this same funnel (see `session-wire.ts` isAgentSessionEvent).
    if ((event as { readonly type?: string }).type === "extension_event") {
      wakeSources.observe(event)
      settlement.reconfirmHeld()
    }
  }

  const stopHeartbeat = startHostHeartbeat({
    taskId,
    intervalMs: heartbeatIntervalMs,
    paused: () => outcome !== undefined || parked || detached,
    port: () => client,
    onState: (state) => {
      lastSeenAt = now()
      identity.observeDurableId(state.sessionId)
    },
    onUnresponsive: () => {
      settleTurn({ status: "error", failure: { kind: "child-unresponsive", message: unresponsiveMessage(taskId) } })
      settleExit({ kind: "crashed", facts: { pid: undefined, code: null, signal: null, stderrTail: "child-unresponsive" } })
      void teardown.detach().catch((error: unknown) => {
        log("senpi-task unresponsive host child detach failed", { taskId, error: String(error) })
      })
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

  const settleClassified = (classified: ReturnType<typeof classifySessionExit>): void => settleClassifiedSessionExit(classified, { session: identity.current(), exit: settleExit, park })

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
    closeGraceMs,
    reattach,
    events: shardEvents,
    bound: transportRecovery,
    // A child being closed or terminated is stopping too: a session a late reattach reopens is ended.
    stopRequested: () => stop.requested() || intent !== "running",
    endOnHost: stop.endOnHost,
    stopUnreached: stop.stopUnreached,
    recoveryEnded: (adopted) => {
      stop.recoveryEnded(adopted)
      if (adopted) void inputEffects.reconcile().catch(error => log("senpi-task input reconciliation failed", { taskId, error: String(error) }))
    },
    continueInput: (command) => inputEffects.send(command, identified => client.send(toHostInput(identified))),
    port: () => client,
    identity: identity.current,
    alive: () => intent === "running" && !parked && !detached && outcome === undefined,
    turnSettled: () => turnOutcome !== undefined || reachedIdle,
    adopt: (next) => {
      client = next.client
      identity.adopt(next.session)
      openDisposition = next.attached ? "attached" : "reopened"
      bindHostSessionPort(client, clientBinding)
    },
    turnResumed: () => listeners.emitTurnResumed(),
    reconcile: (reopened: boolean) => reconciliation.reconcile(identity.current().sessionPath, undefined, true, reopened),
    beginContinuation: () => beginTurn(),
    endLost: () => endSession({ kind: "transport_gone" }),
    // Transport failures park in recovery; a prompt rejection keeps its own actionable cause.
    continuationFailed: (error) => {
      if (intent === "running" && !stop.requested() && !detached && outcome === undefined)
        settleTurn(promptFailureOutcome(error))
    },
    park: (reason) => park({ sessionId: identity.current().routingId, sessionPath: identity.current().sessionPath, reason }),
  })

  const clientBinding = {
    currentPort: () => client,
    acceptsLifecycleEvent: () => !parked && !detached && outcome === undefined,
    onEvent: (event: Parameters<ChildEventListener>[0]) => { onSessionEvent(event); listeners.emitEvent(event) },
    onExtensionEvent: listeners.extensionEvents.publish,
    onParked: park,
    onClosed: (event: { readonly reason: string | undefined }) => endSession({ kind: "session_closed", reason: event.reason }),
    onReplaced: (event: HostSessionReplaced) => listeners.emitReplaced(identity.followReplace(event)),
    onTransportGone: recovery.onTransportGone,
  }

  bindHostSessionPort(client, clientBinding)

  const inputEffects = createInputEffects({
    taskId, store: options.inputStore,
    send: command => recovery.issue(toHostInput(command)),
  })

  const beginTurn = (): void => {
    continuationState = continuationState === "pending_delivery" ? "awaiting_start" : "none"
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
    effects: inputEffects, beginTurn, promptFailed: error => settleTurn(promptFailureOutcome(error)),
  })

  const teardown = createHandleTeardown({
    taskId,
    closeGraceMs,
    port: () => client,
    exited: () => outcome !== undefined,
    intent: () => intent,
    markIntent: (next) => { intent = next },
    markDetached: () => { detached = true },
    clearActive: listeners.clearActive,
    stopHeartbeat: () => { inputEffects.stopRetrying(); stopHeartbeat() },
    settle: settleClassified,
    onTornDown: () => {
      tornDown = true
      settlement.cancelConfirmation()
    },
  })

  return {
    reconcileInputs: inputEffects.reconcile,
    task_id: taskId,
    kind: "host-session",
    get hostSession() {
      return { socket: client.socketPath, ...identity.current() }
    },
    get sessionId() {
      return identity.durableId()
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
    steer: delivery.steer,
    followUp: (text) => delivery.runPrompt(text, "followUp"),
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
    reconcileTurn: (record) => reconciliation.reconcile(identity.current().sessionPath, record, false, openDisposition === "reopened"),
    onReconciled: reconciliation.subscribe,
    adoptFinishedTurn: async (finalResponse) => {
      if (turnOutcome !== undefined || settlement.pending() !== undefined) return
      // A state read that fails is not proof of idleness, and must never cost the reattach: stay busy.
      const state = await client.getState().catch(() => undefined)
      if (state === undefined || !sessionIsIdle(state)) return
      if (turnOutcome === undefined && settlement.pending() === undefined) settleTurn({ status: "completed", finalResponse })
    },
    waitForIdle: () => waiters.waitForIdle(reachedIdle || outcome !== undefined),
    hasExited: () => outcome !== undefined,
    // A state read that fails is not proof of idleness, and must never flag the reattach: undefined.
    sessionIdle: async () => {
      const state = await client.getState().catch(() => undefined)
      if (state === undefined) return undefined
      return sessionIsIdle(state)
    },
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
    startInitialPrompt: (text) => delivery.runPrompt(text),
  }
}
