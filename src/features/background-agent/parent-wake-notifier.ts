import { resolveRegisteredAgentName } from "../claude-code-session-state"
import { createInternalAgentTextPart, isSyntheticOrInternalUserMessage, log, messagesInDirectory, normalizeSDKResponse } from "../../shared"
import { isSessionActive as isOpenCodeSessionActive, settleAfterSessionIdle } from "../../hooks/shared/session-idle-settle"
import { dispatchInternalPrompt } from "../../hooks/shared/prompt-async-gate"
import type { PluginInput } from "@opencode-ai/plugin"

type OpencodeClient = PluginInput["client"]

export type ParentWakePromptContext = {
  agent?: string
  model?: { providerID: string; modelID: string }
  variant?: string
  tools?: Record<string, boolean>
}

export type PendingParentWake = {
  promptContext: ParentWakePromptContext
  notifications: string[]
  shouldReply: boolean
  dispatchedAt?: number
  toolCallDeferralStartedAt?: number
}

type ParentWakeSessionMessage = {
  info?: {
    role?: string
    finish?: string
    time?: { created?: unknown }
  }
  role?: string
  finish?: string
  time?: { created?: unknown }
  parts?: Array<{
    type?: string
    text?: string
    synthetic?: boolean
    content?: unknown
    state?: {
      status?: unknown
    }
  }>
}

type ParentWakeNotifierDeps = {
  client: OpencodeClient
  directory: string
  enqueueNotificationForParent: (parentSessionID: string | undefined, operation: () => Promise<void>) => Promise<void>
}

type ParentWakeNotifierOptions = {
  pendingRetryMs: number
  acceptedMessageSkewMs: number
  toolCallDeferMaxMs: number
  failureRequeueWindowMs: number
  /**
   * If the latest message in the parent session is a `user` message added
   * within this window, the parent-wake injection is deferred. Prevents the
   * race where a parent-wake `dispatchInternalPrompt` collides with a fresh
   * user prompt, which on macOS/Electron has triggered native SIGABRT crashes
   * inside OpenCode's `@parcel/watcher` TSFN callback path. See issue #4120.
   */
  userMessageInProgressWindowMs: number
}

type ToolWaitDeferralDecision = {
  defer: boolean
  skipPromptGateToolStateCheck: boolean
}

type Unrefable = ReturnType<typeof setTimeout> & { unref?: () => unknown }

function unrefTimerHandle(handle: ReturnType<typeof setTimeout>): void {
  const maybeUnref = (handle as Unrefable).unref
  if (typeof maybeUnref === "function") {
    try {
      maybeUnref.call(handle)
    } catch {
      // unref is best-effort; some runtimes (e.g. browser-like shims) don't
      // expose it. Failing here would only make the host event loop pinned —
      // not a hard error.
    }
  }
}

export class ParentWakeNotifier {
  private pendingParentWakes: Map<string, PendingParentWake> = new Map()
  private pendingParentWakeTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()
  private dispatchedParentWakes: Map<string, PendingParentWake> = new Map()
  private dispatchedParentWakeTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()

  constructor(
    private readonly deps: ParentWakeNotifierDeps,
    private readonly options: ParentWakeNotifierOptions,
  ) {}

  getPendingParentWakes(): Map<string, PendingParentWake> {
    return this.pendingParentWakes
  }

  getPendingParentWakeTimers(): Map<string, ReturnType<typeof setTimeout>> {
    return this.pendingParentWakeTimers
  }

  getDispatchedParentWakes(): Map<string, PendingParentWake> {
    return this.dispatchedParentWakes
  }

  getDispatchedParentWakeTimers(): Map<string, ReturnType<typeof setTimeout>> {
    return this.dispatchedParentWakeTimers
  }

  queuePendingParentWake(
    sessionID: string,
    notification: string,
    promptContext: ParentWakePromptContext,
    shouldReply: boolean,
    delayMs?: number,
  ): void {
    const resolvedPromptContext = this.resolveParentWakePromptContext(promptContext)
    const pendingWake = this.pendingParentWakes.get(sessionID)
    if (pendingWake) {
      pendingWake.notifications.push(notification)
      pendingWake.promptContext = resolvedPromptContext
      pendingWake.shouldReply = pendingWake.shouldReply || shouldReply
    } else {
      this.pendingParentWakes.set(sessionID, {
        promptContext: resolvedPromptContext,
        notifications: [notification],
        shouldReply,
      })
    }
    this.schedulePendingParentWakeFlush(sessionID, delayMs)
  }

  async flushPendingParentWake(sessionID: string): Promise<void> {
    if (!this.pendingParentWakes.has(sessionID)) {
      this.clearPendingParentWakeTimer(sessionID)
      return
    }

    if (await this.isSessionActive(sessionID)) {
      this.schedulePendingParentWakeFlush(sessionID)
      return
    }

    this.clearPendingParentWakeTimer(sessionID)
    await settleAfterSessionIdle()

    if (await this.isSessionActive(sessionID)) {
      this.schedulePendingParentWakeFlush(sessionID)
      return
    }

    const latestWake = this.pendingParentWakes.get(sessionID)
    if (!latestWake) {
      return
    }

    const toolWaitDecision = await this.shouldDeferParentWakeForSessionHistory(sessionID, latestWake)
    if (toolWaitDecision.defer) {
      this.schedulePendingParentWakeFlush(sessionID)
      return
    }

    if (await this.isUserMessageInProgress(sessionID)) {
      // The user just sent a new message into the parent session. Dispatching
      // a parent-wake right now would race their prompt and, on Electron-hosted
      // OpenCode (macOS arm64), has been observed to crash the sidecar via
      // @parcel/watcher TSFN callbacks firing into a torn-down JS env.
      // The user's own message will drive the model; the queued notifications
      // will be re-flushed on the next idle. See issue #4120.
      this.schedulePendingParentWakeFlush(sessionID)
      log("[background-agent] Deferred parent wake because user message just arrived:", {
        sessionID,
      })
      return
    }

    this.pendingParentWakes.delete(sessionID)

    const notificationContent = latestWake.notifications.join("\n\n")

    try {
      const dispatchStartedAt = Date.now()
      const promptResult = await dispatchInternalPrompt({
        mode: "async",
        client: this.deps.client,
        sessionID,
        source: "background-agent-parent-wake",
        settleMs: 0,
        postDispatchHoldMs: 250,
        checkToolState: !toolWaitDecision.skipPromptGateToolStateCheck,
        input: {
          path: { id: sessionID },
          body: {
            noReply: !latestWake.shouldReply,
            ...latestWake.promptContext,
            parts: [createInternalAgentTextPart(notificationContent)],
          },
          query: { directory: this.deps.directory },
        },
      })
      if (promptResult.status === "failed") {
        throw promptResult.error
      }
      if (promptResult.status === "reserved" && promptResult.reservedBy === "background-agent-parent-wake") {
        log("[background-agent] Ignored duplicate parent wake flush already reserved by promptAsync gate:", {
          sessionID,
        })
        return
      }
      if (promptResult.status !== "dispatched") {
        this.requeueWake(sessionID, latestWake)
        this.schedulePendingParentWakeFlush(sessionID)
        log("[background-agent] Deferred parent wake skipped by promptAsync gate:", {
          sessionID,
          status: promptResult.status,
        })
        return
      }
      log("[background-agent] Sent deferred parent wake:", { sessionID })
      this.trackDispatchedParentWake(sessionID, latestWake, dispatchStartedAt)
    } catch (error) {
      this.requeueWake(sessionID, latestWake)
      this.schedulePendingParentWakeFlush(sessionID)
      log("[background-agent] Failed to send deferred parent wake:", { sessionID, error })
    }
  }

  clearDispatchedParentWake(sessionID: string): void {
    const timer = this.dispatchedParentWakeTimers.get(sessionID)
    if (timer) {
      clearTimeout(timer)
      this.dispatchedParentWakeTimers.delete(sessionID)
    }
    this.dispatchedParentWakes.delete(sessionID)
  }

  async requeueDispatchedParentWake(sessionID: string, reason: string): Promise<boolean> {
    const wake = this.dispatchedParentWakes.get(sessionID)
    if (!wake) {
      return false
    }

    await settleAfterSessionIdle()

    if (await this.hasAcceptedMessageAfterDispatchedParentWake(sessionID, wake)) {
      this.clearDispatchedParentWake(sessionID)
      log("[background-agent] Ignored late parent wake failure after assistant output:", {
        sessionID,
        reason,
      })
      return false
    }

    this.clearDispatchedParentWake(sessionID)
    this.requeueWake(sessionID, wake)
    this.schedulePendingParentWakeFlush(sessionID)
    log("[background-agent] Requeued dispatched parent wake after prompt failure:", {
      sessionID,
      reason,
    })
    return true
  }

  schedulePendingParentWakeFlush(sessionID: string, delayMs?: number): void {
    if (this.pendingParentWakeTimers.has(sessionID)) {
      return
    }

    const timer = setTimeout(() => {
      this.pendingParentWakeTimers.delete(sessionID)
      void this.deps.enqueueNotificationForParent(sessionID, () => this.flushPendingParentWake(sessionID)).catch((error) => {
        log("[background-agent] Failed to retry pending parent wake:", { sessionID, error })
      })
    }, delayMs ?? this.options.pendingRetryMs)
    // Don't pin the host event loop with retry timers; the sidecar should be
    // free to exit cleanly during teardown even if a wake is still pending.
    // See issue #4120.
    unrefTimerHandle(timer)

    this.pendingParentWakeTimers.set(sessionID, timer)
  }

  clearPendingParentWakeTimer(sessionID: string): void {
    const timer = this.pendingParentWakeTimers.get(sessionID)
    if (!timer) {
      return
    }

    clearTimeout(timer)
    this.pendingParentWakeTimers.delete(sessionID)
  }

  shutdown(): void {
    for (const timer of this.pendingParentWakeTimers.values()) {
      clearTimeout(timer)
    }
    this.pendingParentWakeTimers.clear()

    for (const timer of this.dispatchedParentWakeTimers.values()) {
      clearTimeout(timer)
    }
    this.dispatchedParentWakeTimers.clear()
    this.pendingParentWakes.clear()
    this.dispatchedParentWakes.clear()
  }

  private async isSessionActive(sessionID: string): Promise<boolean> {
    return isOpenCodeSessionActive(this.deps.client, sessionID)
  }

  private resolveParentWakePromptContext(promptContext: ParentWakePromptContext): ParentWakePromptContext {
    const resolvedAgent = resolveRegisteredAgentName(promptContext.agent)
    return {
      ...promptContext,
      ...(resolvedAgent ? { agent: resolvedAgent } : {}),
      ...(promptContext.model ? { model: { ...promptContext.model } } : {}),
      ...(promptContext.tools ? { tools: { ...promptContext.tools } } : {}),
    }
  }

  private cloneParentWake(wake: PendingParentWake): PendingParentWake {
    const promptContext = this.resolveParentWakePromptContext(wake.promptContext)
    return {
      promptContext,
      notifications: [...wake.notifications],
      shouldReply: wake.shouldReply,
      ...(wake.dispatchedAt !== undefined ? { dispatchedAt: wake.dispatchedAt } : {}),
      ...(wake.toolCallDeferralStartedAt !== undefined
        ? { toolCallDeferralStartedAt: wake.toolCallDeferralStartedAt }
        : {}),
    }
  }

  private trackDispatchedParentWake(sessionID: string, wake: PendingParentWake, dispatchedAt: number): void {
    this.clearDispatchedParentWake(sessionID)
    const dispatchedWake = this.cloneParentWake(wake)
    dispatchedWake.dispatchedAt = dispatchedAt
    this.dispatchedParentWakes.set(sessionID, dispatchedWake)
    const timer = setTimeout(() => {
      this.dispatchedParentWakeTimers.delete(sessionID)
      this.dispatchedParentWakes.delete(sessionID)
    }, this.options.failureRequeueWindowMs)
    // Best-effort unref so the dispatched-wake bookkeeping doesn't keep the
    // event loop alive past the natural teardown window (issue #4120).
    unrefTimerHandle(timer)
    this.dispatchedParentWakeTimers.set(sessionID, timer)
  }

  private async loadParentWakeSessionMessages(sessionID: string): Promise<ParentWakeSessionMessage[]> {
    try {
      const messagesResp = await messagesInDirectory(this.deps.client, {
        path: { id: sessionID },
      }, this.deps.directory)
      return normalizeSDKResponse(messagesResp, [] as ParentWakeSessionMessage[])
    } catch (error) {
      log("[background-agent] Failed to inspect parent session messages for wake safety:", {
        sessionID,
        error,
      })
      return []
    }
  }

  private getParentWakeMessageRole(message: ParentWakeSessionMessage): string | undefined {
    return message.info?.role ?? message.role
  }

  private getParentWakeMessageFinish(message: ParentWakeSessionMessage): string | undefined {
    return message.info?.finish ?? message.finish
  }

  private getParentWakeMessageCreatedAt(message: ParentWakeSessionMessage): number | undefined {
    const value = message.info?.time?.created ?? message.time?.created
    if (typeof value === "number" && Number.isFinite(value)) {
      return value
    }
    if (typeof value === "string") {
      const parsed = Date.parse(value)
      return Number.isFinite(parsed) ? parsed : undefined
    }
    if (value instanceof Date) {
      return value.getTime()
    }
    return undefined
  }

  private parentWakePartIsWaitingOnTool(part: NonNullable<ParentWakeSessionMessage["parts"]>[number]): boolean {
    if (part.type !== "tool" && part.type !== "tool_use") {
      return false
    }

    const status = part.state?.status
    return status === "pending" || status === "running"
  }

  private latestAssistantToolWaitState(messages: ParentWakeSessionMessage[]): {
    waiting: boolean
    createdAt?: number
  } {
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index]
      if (!message) {
        continue
      }
      const role = this.getParentWakeMessageRole(message)
      if (role === "assistant") {
        const waiting = this.getParentWakeMessageFinish(message) === "tool-calls"
          || message.parts?.some((part) => this.parentWakePartIsWaitingOnTool(part)) === true
        return waiting
          ? { waiting: true, createdAt: this.getParentWakeMessageCreatedAt(message) }
          : { waiting: false }
      }
      if (role === "user") {
        if (isSyntheticOrInternalUserMessage(message)) {
          continue
        }
        return { waiting: false }
      }
    }
    return { waiting: false }
  }

  private parentWakeMessageHasOutput(message: ParentWakeSessionMessage): boolean {
    const role = this.getParentWakeMessageRole(message)
    if (role !== "assistant" && role !== "tool") {
      return false
    }
    if (!message.parts || message.parts.length === 0) {
      return role === "assistant"
    }
    return message.parts.some((part) => {
      if (part.type === "text" || part.type === "reasoning") {
        return typeof part.text === "string" && part.text.trim().length > 0
      }
      if (part.type === "tool" || part.type === "tool_result") {
        return true
      }
      if (part.content !== undefined) {
        if (typeof part.content === "string") {
          return part.content.trim().length > 0
        }
        if (Array.isArray(part.content)) {
          return part.content.length > 0
        }
        return true
      }
      return false
    })
  }

  private parentWakeMessageContainsNotification(message: ParentWakeSessionMessage, wake: PendingParentWake): boolean {
    if (this.getParentWakeMessageRole(message) !== "user") {
      return false
    }
    return message.parts?.some((part) =>
      typeof part.text === "string" && wake.notifications.some((notification) => part.text?.includes(notification))
    ) ?? false
  }

  private async isUserMessageInProgress(sessionID: string): Promise<boolean> {
    if (this.options.userMessageInProgressWindowMs <= 0) {
      return false
    }
    const messages = await this.loadParentWakeSessionMessages(sessionID)
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index]
      if (!message) {
        continue
      }
      const role = this.getParentWakeMessageRole(message)
      if (role === "user") {
        if (isSyntheticOrInternalUserMessage(message)) {
          continue
        }
        const createdAt = this.getParentWakeMessageCreatedAt(message)
        if (createdAt === undefined) {
          return false
        }
        return Date.now() - createdAt <= this.options.userMessageInProgressWindowMs
      }
      if (role === "assistant" || role === "tool") {
        // An assistant/tool message is more recent than the last user message,
        // so the user is not actively prompting right now.
        return false
      }
    }
    return false
  }

  private async shouldDeferParentWakeForSessionHistory(
    sessionID: string,
    wake: PendingParentWake,
  ): Promise<ToolWaitDeferralDecision> {
    const messages = await this.loadParentWakeSessionMessages(sessionID)
    const toolWaitState = this.latestAssistantToolWaitState(messages)
    if (!toolWaitState.waiting) {
      delete wake.toolCallDeferralStartedAt
      return { defer: false, skipPromptGateToolStateCheck: false }
    }
    const now = Date.now()
    wake.toolCallDeferralStartedAt ??= now
    const latestToolWaitAgeMs = toolWaitState.createdAt === undefined
      ? 0
      : now - toolWaitState.createdAt
    if (
      wake.shouldReply
      && now - wake.toolCallDeferralStartedAt >= this.options.toolCallDeferMaxMs
      && latestToolWaitAgeMs >= this.options.toolCallDeferMaxMs
    ) {
      log("[background-agent] Sending parent wake after stale tool-call deferral window:", {
        sessionID,
      })
      return { defer: false, skipPromptGateToolStateCheck: true }
    }
    log("[background-agent] Deferred parent wake because latest assistant turn is waiting on tool results:", {
      sessionID,
    })
    return { defer: true, skipPromptGateToolStateCheck: false }
  }

  private async hasAcceptedMessageAfterDispatchedParentWake(sessionID: string, wake: PendingParentWake): Promise<boolean> {
    if (wake.dispatchedAt === undefined) {
      return false
    }
    const dispatchedAt = wake.dispatchedAt
    const messages = await this.loadParentWakeSessionMessages(sessionID)
    return messages.some((message) => {
      const createdAt = this.getParentWakeMessageCreatedAt(message)
      if (createdAt === undefined) {
        return false
      }
      if (
        createdAt >= dispatchedAt - this.options.acceptedMessageSkewMs
        && this.parentWakeMessageContainsNotification(message, wake)
      ) {
        return true
      }
      return createdAt >= dispatchedAt && this.parentWakeMessageHasOutput(message)
    })
  }

  private requeueWake(sessionID: string, latestWake: PendingParentWake): void {
    const pendingWake = this.pendingParentWakes.get(sessionID)
    if (pendingWake) {
      pendingWake.notifications.unshift(...latestWake.notifications)
      pendingWake.shouldReply = pendingWake.shouldReply || latestWake.shouldReply
      pendingWake.promptContext = latestWake.promptContext
      pendingWake.toolCallDeferralStartedAt ??= latestWake.toolCallDeferralStartedAt
      return
    }
    this.pendingParentWakes.set(sessionID, this.cloneParentWake(latestWake))
  }
}
