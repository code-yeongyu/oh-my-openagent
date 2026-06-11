import { log, normalizeSDKResponse } from "../../shared"
import { isPromptMessageInspectionAborted } from "../../shared/prompt-async-gate/message-inspection-error"
import type { PromptMessagesQuery } from "../../shared/prompt-async-gate/types"
import { getErrorText } from "./error-classifier"
import type { PendingParentWake } from "./parent-wake-dedupe"
import {
  getParentWakeSessionHistoryDeferralDecision,
  hasAssistantOrToolOutputAfterParentWake,
  hasAssistantOutputAfterParentWakeAdmission,
  hasRecordedParentWakePromptMessage,
  parentWakeUserMessageIsInProgress,
  type ParentWakeSessionMessage,
  type ToolWaitDeferralDecision,
} from "./parent-wake-session-history"

type ParentWakeSessionInspectorClient = {
  readonly session: {
    readonly messages: (input: {
      readonly path: { readonly id: string }
      readonly query: PromptMessagesQuery
    }) => Promise<unknown>
  }
}

type ParentWakeSessionInspectorOptions = {
  readonly directory: string
  readonly acceptedMessageSkewMs: number
  readonly toolCallDeferMaxMs: number
  readonly userMessageInProgressWindowMs: number
  readonly parentSessionActivityInProgressWindowMs?: number
}

export class ParentWakeSessionInspector {
  private recentParentSessionActivity: Map<string, number> = new Map()

  constructor(
    private readonly client: ParentWakeSessionInspectorClient,
    private readonly options: ParentWakeSessionInspectorOptions,
  ) {}

  recordActivity(sessionID: string): void {
    this.recentParentSessionActivity.set(sessionID, Date.now())
  }

  hasRecentActivity(sessionID: string): boolean {
    const windowMs = this.options.parentSessionActivityInProgressWindowMs ?? 0
    if (windowMs <= 0) {
      return false
    }
    const lastActivityAt = this.recentParentSessionActivity.get(sessionID)
    if (lastActivityAt === undefined) {
      return false
    }
    if (Date.now() - lastActivityAt <= windowMs) {
      return true
    }
    this.recentParentSessionActivity.delete(sessionID)
    return false
  }

  async isUserMessageInProgress(sessionID: string): Promise<boolean> {
    const messages = await this.loadMessages(sessionID)
    return parentWakeUserMessageIsInProgress({
      messages,
      windowMs: this.options.userMessageInProgressWindowMs,
    })
  }

  async shouldDeferForHistory(sessionID: string, wake: PendingParentWake): Promise<ToolWaitDeferralDecision> {
    const messages = await this.loadMessages(sessionID)
    return getParentWakeSessionHistoryDeferralDecision({
      sessionID,
      messages,
      wake,
      toolCallDeferMaxMs: this.options.toolCallDeferMaxMs,
    })
  }

  async hasRecordedPromptMessageAfterDispatchedWake(sessionID: string, wake: PendingParentWake): Promise<boolean> {
    const messages = await this.loadMessages(sessionID)
    return hasRecordedParentWakePromptMessage({
      messages,
      wake,
      acceptedMessageSkewMs: this.options.acceptedMessageSkewMs,
    })
  }

  async hasAssistantOutputAfterAdmittedWake(sessionID: string, wake: PendingParentWake): Promise<boolean> {
    const messages = await this.loadMessages(sessionID)
    return hasAssistantOutputAfterParentWakeAdmission({
      messages,
      wake,
    })
  }

  async hasAssistantOrToolOutputAfterDispatchedWake(sessionID: string, wake: PendingParentWake): Promise<boolean> {
    const messages = await this.loadMessages(sessionID)
    return hasAssistantOrToolOutputAfterParentWake({
      messages,
      wake,
    })
  }

  shutdown(): void {
    this.recentParentSessionActivity.clear()
  }

  private async loadMessages(sessionID: string): Promise<ParentWakeSessionMessage[] | undefined> {
    try {
      const messagesResp = await this.client.session.messages({
        path: { id: sessionID },
        query: { directory: this.options.directory },
      })
      const fallback: ParentWakeSessionMessage[] = []
      return normalizeSDKResponse(messagesResp, fallback)
    } catch (error) {
      const errorText = error instanceof Error ? `${error.name}: ${error.message}` : getErrorText(error) || String(error)
      log("[background-agent] Failed to inspect parent session messages for wake safety:", {
        sessionID,
        error: errorText,
      })
      return isPromptMessageInspectionAborted(error) ? [] : undefined
    }
  }
}
