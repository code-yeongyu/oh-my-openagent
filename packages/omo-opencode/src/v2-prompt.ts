import type { Plugin } from "@opencode/plugin"
import type { OhMyOpenCodeConfig } from "./config"
import {
  getMainSessionID,
  getSessionAgent,
  subagentSessions,
} from "./features/claude-code-session-state"
import {
  filterAlreadyInjectedKeywords,
  suppressComboStandalones,
} from "./hooks/keyword-detector/hook"
import type { DetectedKeyword } from "./hooks/keyword-detector/detector"
import {
  detectKeywordsWithType,
  looksLikeSlashCommand,
  removeCodeBlocks,
} from "./hooks/keyword-detector/detector"
import { isNonOmoAgent, isPlannerAgent } from "./hooks/keyword-detector/constants"
import { getUltraworkMessageForSource } from "./hooks/keyword-detector/ultrawork"
import { getUltraworkSource, type UltraworkSource } from "./hooks/keyword-detector/ultrawork/source-detector"
import { log } from "./shared"
import { isSystemDirective, removeSystemReminders } from "./shared/system-directive"

const DEFAULT_MODE_ULTRAWORK_SESSION_CAP = 256
const EXPLICIT_ULTRAWORK_SESSION_CAP = 256

const explicitUltraworkSessions = new Map<string, { source: UltraworkSource }>()
const defaultModeInjectedSessions = new Set<string>()

export function isKeywordDetectorEnabled(pluginConfig: OhMyOpenCodeConfig): boolean {
  return !(pluginConfig.disabled_hooks?.includes("keyword-detector") ?? false)
}

export function detectPromptKeywordsV2(
  text: string,
  sessionID: string,
  pluginConfig: OhMyOpenCodeConfig,
): DetectedKeyword[] {
  if (isSystemDirective(text)) return []
  if (looksLikeSlashCommand(text)) return []

  const agent = getSessionAgent(sessionID)
  if (isNonOmoAgent(agent)) return []

  const cleanText = removeSystemReminders(removeCodeBlocks(text))
  const detectorConfig = pluginConfig.keyword_detector
  let detected = detectKeywordsWithType(
    cleanText,
    agent,
    undefined,
    detectorConfig?.disabled_keywords,
    detectorConfig?.enabled_expansions,
  )

  const explicitUltrawork = detected.some(
    (keyword) => keyword.type === "ultrawork" || keyword.type === "hyperplan-ultrawork",
  )
  if (!explicitUltrawork && explicitUltraworkSessions.has(sessionID)) {
    detected.push({ type: "ultrawork", message: getUltraworkMessageForSource(getUltraworkSource(agent, undefined)) })
  }
  detected = suppressComboStandalones(detected)

  if (isPlannerAgent(agent)) {
    detected = detected.filter(
      (keyword) => keyword.type !== "ultrawork"
        && keyword.type !== "hyperplan"
        && keyword.type !== "hyperplan-ultrawork",
    )
  }

  if (subagentSessions.has(sessionID)) return []

  const mainSessionID = getMainSessionID()
  if (mainSessionID && sessionID !== mainSessionID) {
    detected = detected.filter(
      (keyword) => keyword.type === "ultrawork" || keyword.type === "hyperplan-ultrawork",
    )
    if (detected.length === 0) return []
  }

  return filterAlreadyInjectedKeywords(detected, cleanText)
}

export function applyKeywordInjectionV2(
  text: string,
  detected: DetectedKeyword[],
): string {
  if (detected.length === 0) return text
  const messages = detected.map((keyword) => keyword.message).join("\n\n")
  return `${text}\n\n---\n\n${messages}`
}

function rememberExplicitUltrawork(sessionID: string, source: UltraworkSource): void {
  if (!explicitUltraworkSessions.has(sessionID) && explicitUltraworkSessions.size >= EXPLICIT_ULTRAWORK_SESSION_CAP) {
    const oldest = explicitUltraworkSessions.keys().next().value
    if (oldest !== undefined) explicitUltraworkSessions.delete(oldest)
  }
  explicitUltraworkSessions.set(sessionID, { source })
}

export function clearPromptSessionState(sessionID: string): void {
  explicitUltraworkSessions.delete(sessionID)
  defaultModeInjectedSessions.delete(sessionID)
}

export async function registerPromptV2Hook(
  ctx: Plugin.Context,
  pluginConfig: OhMyOpenCodeConfig,
): Promise<void> {
  if (!isKeywordDetectorEnabled(pluginConfig)) return

  await ctx.session.hook("prompt", (event) => {
    const sessionID = event.sessionID
    const detected = detectPromptKeywordsV2(event.prompt.text, sessionID, pluginConfig)

    if (detected.length === 0) {
      if (pluginConfig.default_mode?.ultrawork === true) {
        const mainSessionID = getMainSessionID()
        if ((!mainSessionID || sessionID === mainSessionID) && !defaultModeInjectedSessions.has(sessionID)) {
          if (defaultModeInjectedSessions.size >= DEFAULT_MODE_ULTRAWORK_SESSION_CAP) {
            const oldest = defaultModeInjectedSessions.values().next().value
            if (oldest !== undefined) defaultModeInjectedSessions.delete(oldest)
          }
          defaultModeInjectedSessions.add(sessionID)
          // V1 surfaced this via system transform + toast; V2 appends the
          // default guidance to the admitted prompt (no toast API on ctx).
          event.prompt.text = applyKeywordInjectionV2(event.prompt.text, [
            { type: "ultrawork", message: getUltraworkMessageForSource("default") },
          ])
          log("[keyword-detector] Default ultrawork mode auto-activated", { sessionID })
        }
      }
      return
    }

    const explicitUltrawork = detected.some(
      (keyword) => keyword.type === "ultrawork" || keyword.type === "hyperplan-ultrawork",
    )
    if (explicitUltrawork) {
      rememberExplicitUltrawork(sessionID, getUltraworkSource(getSessionAgent(sessionID), undefined))
    }

    event.prompt.text = applyKeywordInjectionV2(event.prompt.text, detected)
    log("[keyword-detector] Detected keywords (v2 prompt hook)", {
      sessionID,
      types: detected.map((keyword) => keyword.type),
    })
  })
}
