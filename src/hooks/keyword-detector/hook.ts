import type { PluginInput } from "@opencode-ai/plugin"
import type { DefaultModeConfig } from "../../config/schema/default-mode"
import type { KeywordDetectorConfig } from "../../config/schema/keyword-detector"
import {
  getMainSessionID,
  getSessionAgent,
  subagentSessions,
} from "../../features/claude-code-session-state"
import type { ContextCollector } from "../../features/context-injector"
import {
  isRealUserTextPart,
  isSyntheticOrInternalOnlyTextParts,
  log,
} from "../../shared"
import {
  isSystemDirective,
  removeSystemReminders,
} from "../../shared/system-directive"
import type { RalphLoopHook } from "../ralph-loop"
import { isNonOmoAgent, isPlannerAgent } from "./constants"
import type { DetectedKeyword } from "./detector"
import { detectKeywordsWithType, extractPromptText, looksLikeSlashCommand } from "./detector"

const defaultModeUltraworkInjectedSessions = new Set<string>()

function suppressComboStandalones(detected: DetectedKeyword[]): DetectedKeyword[] {
  const hasCombo = detected.some((k) => k.type === "hyperplan-ultrawork")
  if (!hasCombo) return detected
  return detected.filter((k) => k.type !== "ultrawork" && k.type !== "hyperplan")
}

function filterAlreadyInjectedKeywords(
  detected: DetectedKeyword[],
  text: string,
): DetectedKeyword[] {
  return detected.filter((keyword) => !text.includes(keyword.message))
}

export function createKeywordDetectorHook(
  ctx: PluginInput,
  _collector?: ContextCollector,
  _ralphLoop?: Pick<RalphLoopHook, "startLoop">,
  config?: KeywordDetectorConfig,
  defaultMode?: DefaultModeConfig,
) {
  const disabledKeywords = config?.disabled_keywords
  const enabledExpansions = config?.enabled_expansions
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

      const promptText = extractPromptText(output.parts)

      if (isSystemDirective(promptText)) {
        log(`[keyword-detector] Skipping system directive message`, { sessionID: input.sessionID })
        return
      }

      if (looksLikeSlashCommand(promptText)) {
        log(`[keyword-detector] Skipping slash command invocation`, { sessionID: input.sessionID })
        return
      }

      const currentAgent = getSessionAgent(input.sessionID) ?? input.agent

      if (isNonOmoAgent(currentAgent)) {
        log(`[keyword-detector] Skipping keyword injection for non-OMO agent`, { sessionID: input.sessionID, agent: currentAgent })
        return
      }

      const cleanText = removeSystemReminders(promptText)
      const modelID = input.model?.modelID
      let detectedKeywords = detectKeywordsWithType(cleanText, currentAgent, modelID, disabledKeywords, enabledExpansions)
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
          defaultModeUltraworkInjectedSessions.add(input.sessionID)

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
      if (hasUltrawork) {
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

      const textPartIndex = output.parts.findIndex(isRealUserTextPart)
      if (textPartIndex === -1) {
        log(`[keyword-detector] No text part found, skipping injection`, { sessionID: input.sessionID })
        return
      }

      const allMessages = detectedKeywords.map((k) => k.message).join("\n\n")
      const originalText = output.parts[textPartIndex].text ?? ""

      output.parts[textPartIndex].text = `${allMessages}\n\n---\n\n${originalText}`

      log(`[keyword-detector] Detected ${detectedKeywords.length} keywords`, {
        sessionID: input.sessionID,
        types: detectedKeywords.map((k) => k.type),
      })
    },
  }
}
