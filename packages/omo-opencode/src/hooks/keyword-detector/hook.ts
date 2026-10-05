import type { PluginInput } from "@opencode-ai/plugin"
import type { DefaultModeConfig } from "../../config/schema/default-mode"
import type { KeywordDetectorConfig } from "../../config/schema/keyword-detector"
import {
  getMainSessionID,
  getSessionAgent,
  subagentSessions,
} from "../../features/claude-code-session-state"
import type { ContextCollector } from "../../features/context-injector"
import { generatePartId } from "../../features/hook-message-injector"
import {
  isRealUserTextPart,
  isSyntheticOrInternalOnlyTextParts,
  log,
} from "../../shared"
import { resolveSessionEventID } from "../../shared/event-session-id"
import {
  isSystemDirective,
  removeSystemReminders,
} from "../../shared/system-directive"
import { isNonOmoAgent, isPlannerAgent } from "./constants"
import type { DetectedKeyword } from "./detector"
import { detectKeywordsWithType, extractPromptText, looksLikeSlashCommand } from "./detector"
import { getUltraworkMessageForSource } from "./ultrawork"
import { getUltraworkSource, type UltraworkSource } from "./ultrawork/source-detector"

const defaultModeUltraworkInjectedSessions = new Set<string>()
const DEFAULT_MODE_ULTRAWORK_SESSION_CAP = 256
const ULTRAWORK_CONTINUATION_MARKER = "<ultrawork-mode>active</ultrawork-mode>"

type ExplicitUltraworkSession = {
  source: UltraworkSource
  needsRestoration: boolean
}

function rememberDefaultModeUltraworkInjectedSession(sessionID: string): void {
  if (defaultModeUltraworkInjectedSessions.has(sessionID)) return
  if (defaultModeUltraworkInjectedSessions.size >= DEFAULT_MODE_ULTRAWORK_SESSION_CAP) {
    const oldest = defaultModeUltraworkInjectedSessions.values().next().value
    if (oldest !== undefined) defaultModeUltraworkInjectedSessions.delete(oldest)
  }
  defaultModeUltraworkInjectedSessions.add(sessionID)
}

function clearDefaultModeUltraworkInjectedSession(sessionID: string): void {
  defaultModeUltraworkInjectedSessions.delete(sessionID)
}

function clearAllDefaultModeUltraworkInjectedSessions(): void {
  defaultModeUltraworkInjectedSessions.clear()
}

function suppressComboStandalones(detected: DetectedKeyword[]): DetectedKeyword[] {
  const hasCombo = detected.some((k) => k.type === "hyperplan-ultrawork")
  if (!hasCombo) return detected
  return detected.filter((k) => k.type !== "ultrawork" && k.type !== "hyperplan")
}

function filterAlreadyInjectedKeywords(
  detected: DetectedKeyword[],
  text: string,
): DetectedKeyword[] {
  return detected.filter((keyword) => !text.includes(keyword.message.trim()))
}

export function createKeywordDetectorHook(
  ctx: PluginInput,
  _collector?: ContextCollector,
  _ralphLoop?: unknown,
  config?: KeywordDetectorConfig,
  defaultMode?: DefaultModeConfig,
) {
  const disabledKeywords = config?.disabled_keywords
  const enabledExpansions = config?.enabled_expansions
  const explicitUltraworkSessions = new Map<string, ExplicitUltraworkSession>()
  function getRuntimeVariant(input: { variant?: string }, message: Record<string, unknown>): string | undefined {
    if (typeof message.variant === "string") {
      return message.variant
    }

    return typeof input.variant === "string" ? input.variant : undefined
  }

  return {
    "chat.message": async (
      input: {
        sessionID: string
        agent?: string
        model?: { providerID: string; modelID: string }
        messageID?: string
        variant?: string
      },
      output: {
        message: Record<string, unknown>
        parts: Array<{ type: string; text?: string; [key: string]: unknown }>
      }
    ): Promise<void> => {
      if (isSyntheticOrInternalOnlyTextParts(output.parts)) {
        log(`[keyword-detector] Skipping synthetic/internal text message`, { sessionID: input.sessionID })
        return
      }

      const promptText = extractPromptText(output.parts.filter(isRealUserTextPart))

      if (isSystemDirective(promptText)) {
        log(`[keyword-detector] Skipping system directive message`, { sessionID: input.sessionID })
        return
      }

      if (looksLikeSlashCommand(promptText)) {
        if (/^\s*\/stop-continuation(?:\s|$)/i.test(promptText)) {
          explicitUltraworkSessions.delete(input.sessionID)
        }
        log(`[keyword-detector] Skipping slash command invocation`, { sessionID: input.sessionID })
        return
      }

      const currentAgent = getSessionAgent(input.sessionID) ?? input.agent

      if (isNonOmoAgent(currentAgent)) {
        log(`[keyword-detector] Skipping keyword injection for non-OMO agent`, { sessionID: input.sessionID, agent: currentAgent })
        return
      }

      const cleanText = removeSystemReminders(promptText)
      const selectedModel = output.message.model
      const modelID = selectedModel !== null && typeof selectedModel === "object"
        && "modelID" in selectedModel && typeof selectedModel.modelID === "string"
        ? selectedModel.modelID
        : input.model?.modelID
      const promptSource = getUltraworkSource(currentAgent, modelID)
      let detectedKeywords = detectKeywordsWithType(cleanText, currentAgent, modelID, disabledKeywords, enabledExpansions)
      const explicitUltrawork = detectedKeywords.some((k) => k.type === "ultrawork" || k.type === "hyperplan-ultrawork")
      const activeUltrawork = explicitUltraworkSessions.get(input.sessionID)
      const replayUltrawork = !explicitUltrawork && activeUltrawork !== undefined
      const compactUltrawork = activeUltrawork !== undefined && !activeUltrawork.needsRestoration && activeUltrawork.source === promptSource
      if (replayUltrawork) {
        detectedKeywords.push({ type: "ultrawork", message: getUltraworkMessageForSource(promptSource) })
      }
      detectedKeywords = suppressComboStandalones(detectedKeywords)

      if (isPlannerAgent(currentAgent)) {
        const preFilterCount = detectedKeywords.length
        detectedKeywords = detectedKeywords.filter(
          (k) => k.type !== "ultrawork" && k.type !== "hyperplan" && k.type !== "hyperplan-ultrawork"
        )
        if (preFilterCount > detectedKeywords.length) {
          log(`[keyword-detector] Filtered ultrawork/hyperplan keywords for planner agent`, { sessionID: input.sessionID, agent: currentAgent })
        }
      }

      const isBackgroundTaskSession = subagentSessions.has(input.sessionID)
      if (isBackgroundTaskSession) {
        if (detectedKeywords.length > 0) {
          log(`[keyword-detector] Skipping keyword injection for background task session`, { sessionID: input.sessionID })
        }
        return
      }

      const mainSessionID = getMainSessionID()
      const isNonMainSession = mainSessionID && input.sessionID !== mainSessionID

      if (detectedKeywords.length === 0) {
        if (defaultMode?.ultrawork && !isNonMainSession && !defaultModeUltraworkInjectedSessions.has(input.sessionID)) {
          rememberDefaultModeUltraworkInjectedSession(input.sessionID)

          log(`[keyword-detector] Default ultrawork mode auto-activated (injected via system prompt)`, { sessionID: input.sessionID })

          ctx.client.tui
            .showToast({
              body: {
                title: "Ultrawork Mode Activated",
                message: "Default ultrawork mode enabled. All agents at your disposal.",
                variant: "success" as const,
                duration: 3000,
              },
            })
            .catch((err) =>
              log(`[keyword-detector] Failed to show toast`, {
                error: err,
                sessionID: input.sessionID,
              })
            )
        }
        return
      }

      if (isNonMainSession) {
        detectedKeywords = detectedKeywords.filter(
          (k) => k.type === "ultrawork" || k.type === "hyperplan-ultrawork"
        )
        if (detectedKeywords.length === 0) {
          log(`[keyword-detector] Skipping non-ultrawork keywords in non-main session`, {
            sessionID: input.sessionID,
            mainSessionID,
          })
          return
        }
      }

      detectedKeywords = filterAlreadyInjectedKeywords(detectedKeywords, cleanText)
      if (detectedKeywords.length === 0) {
        log(`[keyword-detector] Skipping already injected keyword messages`, { sessionID: input.sessionID })
        return
      }

      const hasUltrawork = detectedKeywords.some((k) => k.type === "ultrawork")
      if (hasUltrawork && explicitUltrawork) {
        const runtimeVariant = getRuntimeVariant(input, output.message)
        const isRuntimeMax = runtimeVariant === "max"

        log(`[keyword-detector] Ultrawork mode activated`, {
          sessionID: input.sessionID,
          runtimeVariant,
        })

        ctx.client.tui
          .showToast({
            body: {
              title: "Ultrawork Mode Activated",
              message: isRuntimeMax
                ? "Maximum precision engaged. All agents at your disposal."
                : "Runtime variant preserved. All agents at your disposal.",
              variant: "success" as const,
              duration: 3000,
            },
          })
          .catch((err) =>
            log(`[keyword-detector] Failed to show toast`, {
              error: err,
              sessionID: input.sessionID,
            })
          )

      }

      const hasHyperplan = detectedKeywords.some((k) => k.type === "hyperplan")
      if (hasHyperplan) {
        log(`[keyword-detector] Hyperplan mode activated`, {
          sessionID: input.sessionID,
        })

        ctx.client.tui
          .showToast({
            body: {
              title: "Hyperplan Mode Activated",
              message: "Adversarial planning engaged. 5 hostile members will cross-critique.",
              variant: "success" as const,
              duration: 3000,
            },
          })
          .catch((err) =>
            log(`[keyword-detector] Failed to show toast`, {
              error: err,
              sessionID: input.sessionID,
            })
          )
      }

      const hasHyperplanUltrawork = detectedKeywords.some((k) => k.type === "hyperplan-ultrawork")
      if (hasHyperplanUltrawork) {
        log(`[keyword-detector] Hyperplan Ultrawork mode activated`, { sessionID: input.sessionID })
        ctx.client.tui
          .showToast({
            body: {
              title: "Hyperplan Ultrawork Mode Activated",
              message: "Ultrawork execution with adversarial hyperplan workflow.",
              variant: "success" as const,
              duration: 3000,
            },
          })
          .catch((err) => log(`[keyword-detector] Failed to show toast`, { error: err, sessionID: input.sessionID }))
      }

      const allMessages = detectedKeywords
        .filter((k) => !(compactUltrawork && k.type === "ultrawork"))
        .map((k) => k.message).join("\n\n")
      const textPart = output.parts.find(isRealUserTextPart)
      const requiresFullGuidance = (hasUltrawork || hasHyperplanUltrawork) && !compactUltrawork && allMessages.length > 0
      const messageID = input.messageID ?? (typeof output.message.id === "string" ? output.message.id : undefined)
      let fullGuidanceDurablyAdded = textPart !== undefined && requiresFullGuidance

      if (textPart && allMessages) {
        textPart.text = `${textPart.text}\n\n---\n\n${allMessages}`
      }
      if (!textPart && requiresFullGuidance && messageID) {
        output.parts.push({
          id: generatePartId(),
          sessionID: input.sessionID,
          messageID,
          type: "text",
          text: allMessages,
          synthetic: true,
        })
        fullGuidanceDurablyAdded = true
      }
      if (hasUltrawork && compactUltrawork && !output.parts.some(
        (part) => part.synthetic === true && part.text === ULTRAWORK_CONTINUATION_MARKER,
      ) && messageID) {
        output.parts.push({
          id: generatePartId(),
          sessionID: input.sessionID,
          messageID,
          type: "text",
          text: ULTRAWORK_CONTINUATION_MARKER,
          synthetic: true,
        })
      }

      if ((explicitUltrawork || replayUltrawork) && (hasUltrawork || hasHyperplanUltrawork) && (!requiresFullGuidance || fullGuidanceDurablyAdded)) {
        if (!explicitUltraworkSessions.has(input.sessionID) && explicitUltraworkSessions.size >= DEFAULT_MODE_ULTRAWORK_SESSION_CAP) {
          const oldest = explicitUltraworkSessions.keys().next().value
          if (oldest !== undefined) explicitUltraworkSessions.delete(oldest)
        }
        explicitUltraworkSessions.set(input.sessionID, { source: promptSource, needsRestoration: false })
      }

      log(`[keyword-detector] Detected ${detectedKeywords.length} keywords`, {
        sessionID: input.sessionID,
        types: detectedKeywords.map((k) => k.type),
      })
    },
    clearSession: (sessionID: string): void => {
      explicitUltraworkSessions.delete(sessionID)
    },
    getSystemTransformGuidance: (sessionID: string, modelID?: string): string | undefined => {
      const activeUltrawork = explicitUltraworkSessions.get(sessionID)
      const agent = getSessionAgent(sessionID)
      if (!activeUltrawork?.needsRestoration || isPlannerAgent(agent)
        || isNonOmoAgent(agent) || subagentSessions.has(sessionID)) return undefined
      return getUltraworkMessageForSource(
        modelID === undefined ? activeUltrawork.source : getUltraworkSource(agent, modelID),
      )
    },
    event: ({ event }: { event: { type: string; properties?: unknown } }): void => {
      if (event.type !== "session.deleted" && event.type !== "session.compacted") return
      const sessionID = resolveSessionEventID(event.properties)
      if (sessionID) {
        if (event.type === "session.compacted") {
          const activeUltrawork = explicitUltraworkSessions.get(sessionID)
          if (activeUltrawork) {
            explicitUltraworkSessions.set(sessionID, { ...activeUltrawork, needsRestoration: true })
          }
          return
        }
        clearDefaultModeUltraworkInjectedSession(sessionID)
        explicitUltraworkSessions.delete(sessionID)
      }
    },
    dispose: (): void => {
      clearAllDefaultModeUltraworkInjectedSessions()
      explicitUltraworkSessions.clear()
    },
  }
}
