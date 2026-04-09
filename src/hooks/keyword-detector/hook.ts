import type { PluginInput } from "@opencode-ai/plugin"
import { detectKeywordsWithType, extractPromptText } from "./detector"
import { isPlannerAgent, isNonOmoAgent } from "./constants"
import { log } from "../../shared"
import {
  isSystemDirective,
  removeSystemReminders,
} from "../../shared/system-directive"
import {
  getMainSessionID,
  getSessionAgent,
  subagentSessions,
} from "../../features/claude-code-session-state"
import type { ContextCollector } from "../../features/context-injector"
import type { RalphLoopHook } from "../ralph-loop"
import { parseRalphLoopArguments } from "../ralph-loop/command-arguments"

const ULTRAWORK_KEYWORD_PATTERN = /\b(ultrawork|ulw)\b/i
const LEADING_ULTRAWORK_PATTERN = /^\s*(ultrawork|ulw)\b/i
const TRAILING_GREETING_ULTRAWORK_PATTERN = /^\s*(?:hi|hello|hey|hiya|greetings)(?:\s+there)?\s+(ultrawork|ulw)\s*$/i

function extractUltraworkTask(cleanText: string): string {
  if (TRAILING_GREETING_ULTRAWORK_PATTERN.test(cleanText)) {
    return ""
  }

  return cleanText.replace(ULTRAWORK_KEYWORD_PATTERN, "").trim()
}

function hasEdgeUltraworkKeyword(cleanText: string): boolean {
  return LEADING_ULTRAWORK_PATTERN.test(cleanText) || TRAILING_GREETING_ULTRAWORK_PATTERN.test(cleanText)
}

export function createKeywordDetectorHook(
  ctx: PluginInput,
  _collector?: ContextCollector,
  ralphLoop?: Pick<RalphLoopHook, "startLoop">
) {
  function getRuntimeVariant(input: { variant?: string }, message: Record<string, unknown>): string | undefined {
    if (typeof message["variant"] === "string") {
      return message["variant"]
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
      const promptText = extractPromptText(output.parts)

      if (isSystemDirective(promptText)) {
        log(`[keyword-detector] Skipping system directive message`, { sessionID: input.sessionID })
        return
      }

      const currentAgent = getSessionAgent(input.sessionID) ?? input.agent

      // Skip all keyword injection for non-OMO agents (e.g., OpenCode-Builder, Plan)
      if (isNonOmoAgent(currentAgent)) {
        log(`[keyword-detector] Skipping keyword injection for non-OMO agent`, { sessionID: input.sessionID, agent: currentAgent })
        return
      }

      // Remove system-reminder content to prevent automated system messages from triggering mode keywords
      const cleanText = removeSystemReminders(promptText)
      const modelID = input.model?.modelID
      let detectedKeywords = detectKeywordsWithType(cleanText, currentAgent, modelID)

      if (isPlannerAgent(currentAgent)) {
        const preFilterCount = detectedKeywords.length
        detectedKeywords = detectedKeywords.filter((k) => k.type !== "ultrawork")
        if (preFilterCount > detectedKeywords.length) {
          log(`[keyword-detector] Filtered ultrawork keywords for planner agent`, { sessionID: input.sessionID, agent: currentAgent })
        }
      }

      if (!hasEdgeUltraworkKeyword(cleanText)) {
        const preFilterCount = detectedKeywords.length
        detectedKeywords = detectedKeywords.filter((k) => k.type !== "ultrawork")
        if (preFilterCount > detectedKeywords.length) {
          log(`[keyword-detector] Filtered non-edge ultrawork keyword`, {
            sessionID: input.sessionID,
          })
        }
      }

      if (detectedKeywords.length === 0) {
        return
      }

      const isBackgroundTaskSession = subagentSessions.has(input.sessionID)
      if (isBackgroundTaskSession) {
        log(`[keyword-detector] Skipping keyword injection for background task session`, { sessionID: input.sessionID })
        return
      }

      const mainSessionID = getMainSessionID()
      const isNonMainSession = mainSessionID && input.sessionID !== mainSessionID

      if (isNonMainSession) {
        detectedKeywords = detectedKeywords.filter((k) => k.type === "ultrawork")
        if (detectedKeywords.length === 0) {
          log(`[keyword-detector] Skipping non-ultrawork keywords in non-main session`, {
            sessionID: input.sessionID,
            mainSessionID,
          })
          return
        }
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

        if (ralphLoop) {
          const userTask = extractUltraworkTask(cleanText)
          const parsedArguments = parseRalphLoopArguments(userTask)
          ralphLoop.startLoop(input.sessionID, parsedArguments.prompt, {
            ultrawork: true,
            maxIterations: parsedArguments.maxIterations,
            completionPromise: parsedArguments.completionPromise,
            strategy: parsedArguments.strategy,
          })
        }
      }

      const textPartIndex = output.parts.findIndex((p) => p.type === "text" && p.text !== undefined)
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
