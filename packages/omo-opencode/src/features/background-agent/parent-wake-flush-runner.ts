import { log } from "../../shared"
import { isSessionActive as isOpenCodeSessionActive, settleAfterSessionIdle } from "../../hooks/shared/session-idle-settle"
import type { InternalPromptQueueBehavior } from "../../shared/prompt-async-gate/types"
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
  readonly maxDeferMs: number
}

export class ParentWakeFlushRunner {
  constructor(private readonly deps: ParentWakeFlushRunnerDeps) {}

  // Monotonic token bound to each force-queue attempt so stale
  // gate callbacks (onDispatched / onExpiredOrFailed) only mutate the wake they
  // actually belong to.
  private forceQueueTokenSeq = 0

  async flushPendingParentWake(sessionID: string): Promise<void> {
    const initialWake = this.deps.pendingQueue.getWake(sessionID)
    if (!initialWake) {
      this.clearPendingParentWakeTimer(sessionID)
      return
    }

    // BUG B1: bound deferral. A parent kept continuously busy (ultrawork /
    // todo-continuation loops re-prompting at every turn end) would otherwise
    // reschedule this flush at 1s intervals forever (8267x deferral incident,
    // upstream #5089). Once the wake has been deferred past the max, force it
    // through as an admit-only noReply so the content lands at the next turn
    // boundary even while the parent stays busy.
    if (this.hasExceededMaxDeferral(initialWake)) {
      this.clearPendingParentWakeTimer(sessionID)
      await this.forceDispatchAfterMaxDeferral(sessionID, initialWake)
      return
    }

    const sessionActive = await this.isSessionActive(sessionID)
    this.clearPendingParentWakeTimer(sessionID)
    if (!sessionActive) {
      await settleAfterSessionIdle()

      if (await this.isSessionActive(sessionID)) {
        this.recordDeferral(sessionID, initialWake)
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
    // While a forced wake is still queued at the gate
    // it is neither lost nor re-dispatched. Suppress all new dispatch paths and
    // just re-flush; it clears via consume-detection above (gate delivered it)
    // or via the onExpiredOrFailed re-arm (gate dropped it).
    if (latestWake.forcedQueuedAt !== undefined) {
      this.schedulePendingParentWakeFlush(sessionID)
      return
    }
    if (sessionActive) {
      this.recordDeferral(sessionID, latestWake)
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
      this.ensureRetainedReplyReflush(sessionID, latestWake)
      log("[background-agent] Recorded admit-only parent wake because parent session activity is still fresh:", {
        sessionID,
      })
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
      this.ensureRetainedReplyReflush(sessionID, latestWake)
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
      this.ensureRetainedReplyReflush(sessionID, latestWake)
      log("[background-agent] Recorded admit-only parent wake because user message just arrived:", {
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
      toolWaitDecision,
    })
  }

  schedulePendingParentWakeFlush(sessionID: string, delayMs?: number): void {
    this.deps.pendingQueue.scheduleFlush(sessionID, () => this.flushPendingParentWake(sessionID), delayMs)
  }

  // Reply-required wakes must never be consumed by an admit-only noReply
  // dispatch (issues #4874/#5086): failure wakes stay queued until the parent
  // is safe, and an already-admitted final wake is not re-admitted while the
  // parent remains unsafe.
  private deferReplyWakeWhileUnsafe(sessionID: string, latestWake: PendingParentWake): boolean {
    if (isFailureParentWake(latestWake)) {
      this.recordDeferral(sessionID, latestWake)
      this.schedulePendingParentWakeFlush(sessionID)
      log("[background-agent] Deferred failure parent wake until parent session is safe:", { sessionID })
      return true
    }
    if (latestWake.shouldReply && latestWake.noReplyAdmittedAt !== undefined) {
      this.recordDeferral(sessionID, latestWake)
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
      readonly queueBehavior?: InternalPromptQueueBehavior
      readonly markForceQueued?: (queuedAt: number) => void
      readonly onForceQueueResolved?: () => void
      readonly forceQueueTtlMs?: number
      readonly onForceDispatched?: () => void
    },
  ): Promise<void> {
    if (options.retainPendingWake !== true) {
      this.deps.pendingQueue.deleteWake(sessionID)
    }

    const checkParentSessionExistence = this.deps.notifierDeps.checkParentSessionExistence

    await sendParentWakePrompt({
      client: this.deps.notifierDeps.client,
      directory: this.deps.notifierDeps.directory,
      sessionID,
      latestWake,
      ...(options.forceNoReply !== undefined ? { forceNoReply: options.forceNoReply } : {}),
      ...(options.retainPendingWake !== undefined ? { retainPendingWake: options.retainPendingWake } : {}),
      ...(options.queueBehavior !== undefined ? { queueBehavior: options.queueBehavior } : {}),
      ...(checkParentSessionExistence
        ? { checkSessionExists: (id: string) => checkParentSessionExistence(id) }
        : {}),
      dropWake: () => {
        this.deps.pendingQueue.deleteWake(sessionID)
        this.deps.pendingQueue.clearTimer(sessionID)
        this.deps.dispatchedTracker.clearWake(sessionID)
      },
      ...(options.markForceQueued !== undefined ? { markForceQueued: options.markForceQueued } : {}),
      ...(options.onForceQueueResolved !== undefined ? { onForceQueueResolved: options.onForceQueueResolved } : {}),
      ...(options.forceQueueTtlMs !== undefined ? { forceQueueTtlMs: options.forceQueueTtlMs } : {}),
      ...(options.onForceDispatched !== undefined ? { onForceDispatched: options.onForceDispatched } : {}),
      emptyAssistantTurnRetry: options.emptyAssistantTurnRetry,
      toolWaitDecision: options.toolWaitDecision,
      getDispatchedWake: () => this.deps.dispatchedTracker.getWake(sessionID),
      hasRecordedPromptAfterDispatch: (wake) =>
        this.deps.sessionInspector.hasRecordedPromptMessageAfterDispatchedWake(sessionID, wake),
      trackDispatchedWake: (wake, dispatchedAt) => this.deps.dispatchedTracker.trackWake(sessionID, wake, dispatchedAt),
      requeueWake: (wake) => this.requeueWake(sessionID, wake),
      scheduleFlush: (delayMs) => this.schedulePendingParentWakeFlush(sessionID, delayMs),
    })
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

  private requeueWake(sessionID: string, latestWake: PendingParentWake): void {
    this.deps.pendingQueue.requeueWake(sessionID, latestWake)
  }

  private recordDeferral(sessionID: string, wake: PendingParentWake): void {
    wake.firstDeferredAt ??= Date.now()
    wake.deferCount = (wake.deferCount ?? 0) + 1
    if (wake.deferCount % 60 === 0) {
      log("[background-agent] Parent wake deferred repeatedly without delivery:", {
        sessionID,
        deferCount: wake.deferCount,
      })
    }
  }

  private hasExceededMaxDeferral(wake: PendingParentWake): boolean {
    if (wake.forcedQueuedAt !== undefined) {
      return false
    }
    return wake.firstDeferredAt !== undefined && Date.now() - wake.firstDeferredAt >= this.deps.maxDeferMs
  }

  // BUG B1 force path: deliver the long-deferred wake as an admit-only noReply.
  // queueBehavior "enqueue" makes the gate queue the prompt at a live/reserved
  // turn boundary instead of skipping it, so a perpetually busy parent still
  // receives the content. Reset the deferral budget afterwards so a retained
  // reply wake cannot re-force every second.
  private async forceDispatchAfterMaxDeferral(sessionID: string, wake: PendingParentWake): Promise<void> {
    log("[background-agent] Force-dispatching parent wake after max deferral", {
      sessionID,
      deferCount: wake.deferCount,
      deferredForMs: wake.firstDeferredAt !== undefined ? Date.now() - wake.firstDeferredAt : undefined,
    })
    const forceQueueToken = ++this.forceQueueTokenSeq
    await this.sendParentWakePrompt(sessionID, wake, {
      emptyAssistantTurnRetry: false,
      toolWaitDecision: { defer: false, skipPromptGateToolStateCheck: true },
      forceNoReply: true,
      retainPendingWake: wake.shouldReply,
      queueBehavior: "enqueue",
      markForceQueued: (queuedAt) => this.markForceQueued(sessionID, queuedAt, forceQueueToken),
      onForceQueueResolved: () => this.handleForceQueueResolved(sessionID, forceQueueToken),
      forceQueueTtlMs: this.deps.maxDeferMs,
      onForceDispatched: () => this.handleForceDispatched(sessionID, forceQueueToken),
    })
    const stillPending = this.deps.pendingQueue.getWake(sessionID)
    if (stillPending) {
      // If the force attempt only QUEUED at the gate, leave the deferral budget
      // intact (so an onExpiredOrFailed re-arm re-forces immediately) and let the
      // forcedQueuedAt guard manage it. Otherwise it actually dispatched: reset the
      // budget so a retained reply wake cannot re-force every second.
      if (stillPending.forcedQueuedAt === undefined) {
        delete stillPending.firstDeferredAt
        stillPending.deferCount = 0
      }
      this.schedulePendingParentWakeFlush(sessionID)
    }
  }

  // BUG B2: a retained reply-required wake must always have a re-flush pending
  // so it eventually dispatches with a reply once the parent goes safe (and via
  // the B1 force path if it never does). scheduleFlush is idempotent.
  private ensureRetainedReplyReflush(sessionID: string, latestWake: PendingParentWake): void {
    if (latestWake.shouldReply && this.deps.pendingQueue.hasWake(sessionID)) {
      this.schedulePendingParentWakeFlush(sessionID)
    }
  }

  // A force-dispatch can be QUEUED at the gate rather
  // than dispatched. While queued, the wake stays pending and is neither tracked
  // as dispatched nor re-forced (forcedQueuedAt suppresses hasExceededMaxDeferral).
  private markForceQueued(sessionID: string, queuedAt: number, token: number): void {
    const wake = this.deps.pendingQueue.getWake(sessionID)
    if (wake) {
      wake.forcedQueuedAt = queuedAt
      wake.forceQueueToken = token
    }
  }

  // The gate dropped/expired/failed the queued force entry: clear the marker and
  // re-flush so the force path can re-arm (firstDeferredAt is still in the past).
  private handleForceQueueResolved(sessionID: string, token: number): void {
    const wake = this.deps.pendingQueue.getWake(sessionID)
    if (wake && wake.forceQueueToken === token) {
      delete wake.forcedQueuedAt
      delete wake.forceQueueToken
    }
    this.schedulePendingParentWakeFlush(sessionID)
  }

  // The gate ACTUALLY dispatched the previously-queued
  // force entry — only now is the content in parent history. Record the real
  // noReply admission (mirrors markRetainedNoReplyAdmission) and clear the
  // force-queued marker so a reply-required wake proceeds through the normal
  // retained-reply lifecycle: consume-drop once the parent responds, or a
  // reply-producing resume once the parent is safe. This is what prevents the
  // "delivered but no parent output" deadlock.
  private handleForceDispatched(sessionID: string, token: number): void {
    const wake = this.deps.pendingQueue.getWake(sessionID)
    // Only honor this callback if the wake is STILL the one we
    // force-queued under this token. A newer notification merge rotates the token
    // (clearing it), so a stale entry's onDispatched can never admit content the
    // queued entry did not actually contain.
    if (wake && wake.forceQueueToken === token) {
      // The deferral is over: the content actually reached parent history. Clear
      // the force-queued marker and the B1 deferral budget, and record the real
      // noReply admission so the wake follows the standard retained-reply path.
      delete wake.forcedQueuedAt
      delete wake.forceQueueToken
      delete wake.firstDeferredAt
      wake.deferCount = 0
      if (wake.shouldReply) {
        wake.noReplyAdmittedAt = Date.now()
      }
    }
    this.schedulePendingParentWakeFlush(sessionID)
  }
}
