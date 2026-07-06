import { log } from "../../shared"
import { isSessionActive as isOpenCodeSessionActive, settleAfterSessionIdle } from "../../hooks/shared/session-idle-settle"
import { isFailureParentWake, isRedundantParentWake, type PendingParentWake } from "./parent-wake-dedupe"
import type { ParentWakeDispatchedTracker } from "./parent-wake-dispatched-tracker"
import type { ParentWakePendingQueue } from "./parent-wake-pending-queue"
import { sendParentWakePrompt } from "./parent-wake-prompt-dispatch"
import type { ToolWaitDeferralDecision } from "./parent-wake-session-history"
import type { ParentWakeSessionInspector } from "./parent-wake-session-inspector"
import type { ParentWakeNotifierDeps } from "./parent-wake-notifier-types"

type ParentWakeFlushRunnerDeps = {
  readonly notifierDeps: ParentWakeNotifierDeps
  readonly pendingQueue: ParentWakePendingQueue
  readonly dispatchedTracker: ParentWakeDispatchedTracker
  readonly sessionInspector: ParentWakeSessionInspector
  /**
   * Absolute ceiling after which a pending wake is force-flushed as a reply
   * dispatch even if the parent session is still active (#5864). Undefined
   * preserves the legacy indefinite-defer behavior.
   */
  readonly maxDeferMs?: number
}

export class ParentWakeFlushRunner {
  constructor(private readonly deps: ParentWakeFlushRunnerDeps) {}

  async flushPendingParentWake(sessionID: string): Promise<void> {
    if (!this.deps.pendingQueue.hasWake(sessionID)) {
      this.clearPendingParentWakeTimer(sessionID)
      return
    }

    const sessionActive = await this.isSessionActive(sessionID)
    this.clearPendingParentWakeTimer(sessionID)
    if (!sessionActive) {
      await settleAfterSessionIdle()

      if (await this.isSessionActive(sessionID)) {
        this.schedulePendingParentWakeFlush(sessionID)
        log("[background-agent] Deferred parent wake because parent session became active after idle settle:", {
          sessionID,
        })
        return
      }
    }

    const latestWake = this.deps.pendingQueue.getWake(sessionID)
    if (!latestWake) {
      return
    }
    if (await this.dropAdmittedWakeConsumedByParent(sessionID, latestWake)) {
      return
    }
    const maxDeferMs = this.deps.maxDeferMs
    if (
      maxDeferMs !== undefined
      && latestWake.queuedAt !== undefined
      && Date.now() - latestWake.queuedAt >= maxDeferMs
    ) {
      log("[background-agent] Force-flushing parent wake after max-defer ceiling exceeded:", {
        sessionID,
        queuedAt: latestWake.queuedAt,
        maxDeferMs,
      })
      // Bounded defer (#5864): the parent never emitted session.idle, so the
      // normal sessionActive / hasRecentActivity / history-defer short-circuits
      // would hold this wake indefinitely. Force a reply-producing dispatch that
      // bypasses the prompt-gate busy-status check (forceReplyDispatch disables
      // checkStatus only) — otherwise a permanently-busy parent returns
      // {status:"active"} from the gate and the wake is never delivered. The
      // tool-state check (checkToolState) stays enabled so the gate gets a last
      // chance to reject if the parent's turn became unsafe between the history
      // check above and the dispatch. forceNoReply/retainPendingWake stay
      // undefined → noReply=false (reply) + pending entry cleared on success.
      // promptAsync's queueBehavior: "defer" serializes against any in-flight
      // turn; if the gate still refuses (reserved/queued), sendParentWakePrompt
      // requeues (keeping queuedAt) and reschedules, giving bounded retry.
      //
      // Exception: if the user just sent a fresh message into the parent session,
      // a reply-producing dispatch would race their prompt and can crash the
      // sidecar on Electron/macOS (#4120). In that case, fall back to the same
      // retained noReply admission the normal path uses — the user's own turn
      // consumes the deposit without forking a concurrent assistant turn.
      // Fresh-activity guard: even past the max-defer ceiling, if the parent
      // has emitted a recent message.part.updated/message.updated event, the
      // live turn may still be streaming even though session.messages looks
      // safe/stopped. Forcing a reply-producing dispatch here would inject into
      // an active turn. Fall back to retained noReply admission — the
      // idle/consumption machinery resumes the wake when the turn settles.
      // This mirrors the normal-path hasRecentParentSessionActivity guard below.
      const emptyAssistantTurnRetry = latestWake.allowEmptyAssistantTurnRetry === true
      // Fresh-activity guard: even past the max-defer ceiling, if the parent
      // has emitted a recent message.part.updated/message.updated event, the
      // live turn may still be streaming even though session.messages looks
      // safe/stopped. Forcing a reply-producing dispatch here would inject into
      // an active turn. Fall back to retained noReply admission — the
      // idle/consumption machinery resumes the wake when the turn settles.
      // This mirrors the normal-path hasRecentParentSessionActivity guard below.
      //
      // But only on the first admission: once noReplyAdmittedAt is set, the
      // deposit is already recorded and the wake needs to be *delivered* as a
      // reply. If we keep returning to this guard on every retry (parent emits
      // activity every <5s), deferReplyWakeWhileUnsafe returns true and the
      // wake waits indefinitely — reintroducing #5864's unbounded defer. So
      // after the first noReply admission, skip this guard and let the
      // subsequent guards (user-message, history, forceReplyDispatch) decide.
      if (
        this.hasRecentParentSessionActivity(sessionID)
        && latestWake.noReplyAdmittedAt === undefined
      ) {
        if (this.deferReplyWakeWhileUnsafe(sessionID, latestWake)) {
          return
        }
        await this.sendParentWakePrompt(sessionID, latestWake, {
          emptyAssistantTurnRetry,
          toolWaitDecision: { defer: false, skipPromptGateToolStateCheck: true },
          forceNoReply: true,
          retainPendingWake: latestWake.shouldReply,
        })
        log("[background-agent] Recorded admit-only parent wake during max-defer force because parent session activity is still fresh:", {
          sessionID,
        })
        if (latestWake.shouldReply) {
          this.schedulePendingParentWakeFlush(sessionID)
        }
        return
      }
      if (await this.isUserMessageInProgress(sessionID)) {
        if (this.deferReplyWakeWhileUnsafe(sessionID, latestWake)) {
          return
        }
        await this.sendParentWakePrompt(sessionID, latestWake, {
          emptyAssistantTurnRetry,
          toolWaitDecision: { defer: false, skipPromptGateToolStateCheck: true },
          forceNoReply: true,
          retainPendingWake: latestWake.shouldReply,
        })
        log("[background-agent] Recorded admit-only parent wake during max-defer force because user message just arrived:", {
          sessionID,
        })
        if (latestWake.shouldReply) {
          this.schedulePendingParentWakeFlush(sessionID)
        }
        return
      }
      // History safety: even past the max-defer ceiling, if the parent's
      // latest assistant turn has an outstanding tool call or unanswered
      // question, forcing a reply-producing dispatch would fork a concurrent
      // assistant turn into a turn the history code treats as unsafe. In that
      // case, fall back to retained noReply admission — the idle/consumption
      // machinery resumes the wake when the turn settles. This mirrors the
      // normal-path history deferral at line ~135.
      const maxDeferHistoryDecision = await this.shouldDeferParentWakeForSessionHistory(
        sessionID,
        latestWake,
      )
      if (maxDeferHistoryDecision.defer) {
        if (this.deferReplyWakeWhileUnsafe(sessionID, latestWake)) {
          return
        }
        await this.sendParentWakePrompt(sessionID, latestWake, {
          emptyAssistantTurnRetry,
          toolWaitDecision: { ...maxDeferHistoryDecision, skipPromptGateToolStateCheck: true },
          forceNoReply: true,
          retainPendingWake: latestWake.shouldReply,
        })
        log("[background-agent] Held max-defer force-flush because session history is unsafe:", {
          sessionID,
        })
        if (latestWake.shouldReply) {
          this.schedulePendingParentWakeFlush(sessionID)
        }
        return
      }
      await this.sendParentWakePrompt(sessionID, latestWake, {
        emptyAssistantTurnRetry,
        toolWaitDecision: { defer: false, skipPromptGateToolStateCheck: false },
        forceReplyDispatch: true,
      })
      return
    }
    if (sessionActive) {
      this.schedulePendingParentWakeFlush(sessionID)
      log("[background-agent] Deferred parent wake because parent session is active:", {
        sessionID,
      })
      return
    }

    if (this.hasRecentParentSessionActivity(sessionID)) {
      if (this.deferReplyWakeWhileUnsafe(sessionID, latestWake)) {
        return
      }
      await this.sendParentWakePrompt(sessionID, latestWake, {
        emptyAssistantTurnRetry: false,
        toolWaitDecision: { defer: false, skipPromptGateToolStateCheck: true },
        forceNoReply: true,
        retainPendingWake: latestWake.shouldReply,
      })
      log("[background-agent] Recorded admit-only parent wake because parent session activity is still fresh:", {
        sessionID,
      })
      if (latestWake.shouldReply) {
        this.schedulePendingParentWakeFlush(sessionID)
      }
      return
    }

    const emptyAssistantTurnRetry = latestWake.allowEmptyAssistantTurnRetry === true
    const toolWaitDecision = await this.shouldDeferParentWakeForSessionHistory(sessionID, latestWake)
    if (toolWaitDecision.defer) {
      if (this.deferReplyWakeWhileUnsafe(sessionID, latestWake)) {
        return
      }
      await this.sendParentWakePrompt(sessionID, latestWake, {
        emptyAssistantTurnRetry,
        toolWaitDecision: { ...toolWaitDecision, skipPromptGateToolStateCheck: true },
        forceNoReply: true,
        retainPendingWake: latestWake.shouldReply,
      })
      return
    }

    if (await this.isUserMessageInProgress(sessionID)) {
      // The user just sent a new message into the parent session. Starting a
      // reply-producing parent-wake right now would race their prompt and, on Electron-hosted
      // OpenCode (macOS arm64), has been observed to crash the sidecar via
      // @parcel/watcher TSFN callbacks firing into a torn-down JS env.
      // Store the wake as noReply so the user's own turn can consume it without
      // forking another assistant turn. See issue #4120.
      if (this.deferReplyWakeWhileUnsafe(sessionID, latestWake)) {
        return
      }
      await this.sendParentWakePrompt(sessionID, latestWake, {
        emptyAssistantTurnRetry,
        toolWaitDecision: { defer: false, skipPromptGateToolStateCheck: true },
        forceNoReply: true,
        retainPendingWake: latestWake.shouldReply,
      })
      log("[background-agent] Recorded admit-only parent wake because user message just arrived:", {
        sessionID,
      })
      return
    }

    const finalToolWaitDecision = await this.confirmParentWakeStillSafeForReply(
      sessionID,
      latestWake,
      toolWaitDecision,
    )
    if (finalToolWaitDecision.defer) {
      if (this.deferReplyWakeWhileUnsafe(sessionID, latestWake)) {
        return
      }
      await this.sendParentWakePrompt(sessionID, latestWake, {
        emptyAssistantTurnRetry,
        toolWaitDecision: { ...finalToolWaitDecision, skipPromptGateToolStateCheck: true },
        forceNoReply: true,
        retainPendingWake: latestWake.shouldReply,
      })
      log("[background-agent] Recorded admit-only parent wake because parent session history became unsafe:", {
        sessionID,
      })
      return
    }

    const dispatchedWake = this.deps.dispatchedTracker.getWake(sessionID)
    if (dispatchedWake && isRedundantParentWake(latestWake, dispatchedWake)) {
      this.deps.pendingQueue.deleteWake(sessionID)
      log("[background-agent] Suppressed duplicate parent wake already dispatched:", { sessionID })
      return
    }

    await this.sendParentWakePrompt(sessionID, latestWake, {
      emptyAssistantTurnRetry,
      toolWaitDecision: finalToolWaitDecision,
    })
  }

  schedulePendingParentWakeFlush(sessionID: string, delayMs?: number): void {
    this.deps.pendingQueue.scheduleFlush(sessionID, async () => {
      try {
        await this.flushPendingParentWake(sessionID)
      } finally {
        this.deps.notifierDeps.onScheduledFlushSettled?.(sessionID)
      }
    }, delayMs)
  }

  // Reply-required wakes must never be consumed by an admit-only noReply
  // dispatch (issues #4874/#5086): failure wakes stay queued until the parent
  // is safe, and an already-admitted final wake is not re-admitted while the
  // parent remains unsafe.
  private deferReplyWakeWhileUnsafe(sessionID: string, latestWake: PendingParentWake): boolean {
    if (isFailureParentWake(latestWake)) {
      this.schedulePendingParentWakeFlush(sessionID)
      log("[background-agent] Deferred failure parent wake until parent session is safe:", { sessionID })
      return true
    }
    if (latestWake.shouldReply && latestWake.noReplyAdmittedAt !== undefined) {
      this.schedulePendingParentWakeFlush(sessionID)
      log("[background-agent] Deferred retained reply-required parent wake until parent session is safe:", { sessionID })
      return true
    }
    return false
  }

  clearPendingParentWakeTimer(sessionID: string): void {
    this.deps.pendingQueue.clearTimer(sessionID)
  }

  // A retained reply-required wake is only liveness insurance for a deposit the
  // parent never saw. Assistant output created after the noReply admission means
  // the live turn consumed the deposit — re-dispatching it would inject a
  // duplicate notification and fork a concurrent assistant chain.
  private async dropAdmittedWakeConsumedByParent(sessionID: string, latestWake: PendingParentWake): Promise<boolean> {
    if (latestWake.noReplyAdmittedAt === undefined) {
      return false
    }
    if (!(await this.deps.sessionInspector.hasAssistantOutputAfterAdmittedWake(sessionID, latestWake))) {
      return false
    }
    this.deps.pendingQueue.deleteWake(sessionID)
    this.deps.dispatchedTracker.clearWake(sessionID)
    log("[background-agent] Dropped retained parent wake after parent consumed admitted notification:", { sessionID })
    return true
  }

  private async sendParentWakePrompt(
    sessionID: string,
    latestWake: PendingParentWake,
    options: {
      readonly emptyAssistantTurnRetry: boolean
      readonly toolWaitDecision: ToolWaitDeferralDecision
      readonly forceNoReply?: boolean
      readonly retainPendingWake?: boolean
      readonly forceReplyDispatch?: boolean
    },
  ): Promise<void> {
    // Mark the dispatch in-flight BEFORE the pending entry is deleted so there is
    // never an observable instant where neither the pending queue, the dispatched
    // tracker, nor this marker reports an owed wake. The dispatch await below can
    // run for many seconds (prompt-gate status/message checks + dispatch); by the
    // time it resolves the wake is either tracked as dispatched or requeued back
    // into pending, so clearing the marker in `finally` cannot reopen the gap.
    this.deps.dispatchedTracker.markInFlight(sessionID)
    try {
      if (options.retainPendingWake !== true) {
        this.deps.pendingQueue.deleteWake(sessionID)
      }

      await sendParentWakePrompt({
        client: this.deps.notifierDeps.client,
        directory: this.deps.notifierDeps.directory,
        sessionID,
        latestWake,
        ...(options.forceNoReply !== undefined ? { forceNoReply: options.forceNoReply } : {}),
        ...(options.retainPendingWake !== undefined ? { retainPendingWake: options.retainPendingWake } : {}),
        ...(options.forceReplyDispatch !== undefined ? { forceReplyDispatch: options.forceReplyDispatch } : {}),
        emptyAssistantTurnRetry: options.emptyAssistantTurnRetry,
        toolWaitDecision: options.toolWaitDecision,
        getDispatchedWake: () => this.deps.dispatchedTracker.getWake(sessionID),
        hasRecordedPromptAfterDispatch: (wake) =>
          this.deps.sessionInspector.hasRecordedPromptMessageAfterDispatchedWake(sessionID, wake),
        trackDispatchedWake: (wake, dispatchedAt) => this.deps.dispatchedTracker.trackWake(sessionID, wake, dispatchedAt),
        requeueWake: (wake) => this.requeueWake(sessionID, wake),
        scheduleFlush: (delayMs) => this.schedulePendingParentWakeFlush(sessionID, delayMs),
      })
    } finally {
      this.deps.dispatchedTracker.clearInFlight(sessionID)
    }
  }

  private async isSessionActive(sessionID: string): Promise<boolean> {
    return isOpenCodeSessionActive(this.deps.notifierDeps.client, sessionID)
  }

  private hasRecentParentSessionActivity(sessionID: string): boolean {
    return this.deps.sessionInspector.hasRecentActivity(sessionID)
  }

  private async isUserMessageInProgress(sessionID: string): Promise<boolean> {
    return this.deps.sessionInspector.isUserMessageInProgress(sessionID)
  }

  private async shouldDeferParentWakeForSessionHistory(
    sessionID: string,
    wake: PendingParentWake,
  ): Promise<ToolWaitDeferralDecision> {
    return this.deps.sessionInspector.shouldDeferForHistory(sessionID, wake)
  }

  private async confirmParentWakeStillSafeForReply(
    sessionID: string,
    wake: PendingParentWake,
    decision: ToolWaitDeferralDecision,
  ): Promise<ToolWaitDeferralDecision> {
    if (!decision.skipPromptGateToolStateCheck) {
      return decision
    }
    return this.deps.sessionInspector.shouldDeferForHistory(sessionID, wake)
  }

  private requeueWake(sessionID: string, latestWake: PendingParentWake): void {
    this.deps.pendingQueue.requeueWake(sessionID, latestWake)
  }
}
