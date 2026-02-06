import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared"
import { generateDynamicTriggers, findMatchingTriggers } from "./trigger-generator"
import { HOOK_NAME, type SkillTrigger } from "./types"

export * from "./types"
export * from "./keyword-extractor"
export * from "./trigger-generator"

/**
 * Removes code blocks from text to avoid false keyword matches.
 */
function removeCodeBlocks(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]+`/g, "")
}

/**
 * Extracts text content from message parts.
 */
function extractPromptText(parts: Array<{ type: string; text?: string }>): string {
  return parts
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text!)
    .join(" ")
}

/**
 * Creates the skill auto-trigger hook.
 * 
 * This hook dynamically detects keywords from user input and suggests
 * relevant skills based on their descriptions. Triggers are generated
 * once at plugin load time from all available skills.
 */
export function createSkillAutoTriggerHook(ctx: PluginInput) {
  let dynamicTriggers: SkillTrigger[] = []
  let initialized = false

  // Initialize triggers asynchronously
  const initPromise = generateDynamicTriggers()
    .then((triggers) => {
      dynamicTriggers = triggers
      initialized = true
      log(`[${HOOK_NAME}] Loaded ${triggers.length} dynamic skill triggers`)
    })
    .catch((err) => {
      log(`[${HOOK_NAME}] Failed to load triggers`, { error: String(err) })
    })

  return {
    "chat.message": async (
      input: {
        sessionID: string
        agent?: string
      },
      output: {
        message: Record<string, unknown>
        parts: Array<{ type: string; text?: string; [key: string]: unknown }>
      }
    ): Promise<void> => {
      // Wait for initialization if not ready
      if (!initialized) {
        await initPromise
      }

      if (dynamicTriggers.length === 0) {
        return
      }

      const promptText = extractPromptText(output.parts)
      if (!promptText.trim()) {
        return
      }

      // Remove code blocks to avoid false matches
      const cleanText = removeCodeBlocks(promptText)

      // Find matching triggers
      const matches = findMatchingTriggers(cleanText, dynamicTriggers)
      if (matches.length === 0) {
        return
      }

      // Take top match (highest priority)
      const topMatch = matches[0]

      // Build suggestion message
      const suggestion = `[skill-available]
**Skill:** \`${topMatch.skillName}\`
${topMatch.description}

If relevant, invoke: \`skill("${topMatch.skillName}")\``

      // Prepend suggestion to first text part
      if (output.parts.length > 0 && output.parts[0].type === "text") {
        output.parts[0].text = `${suggestion}\n\n---\n\n${output.parts[0].text || ""}`
      }

      log(`[${HOOK_NAME}] Suggested skill`, {
        sessionID: input.sessionID,
        skill: topMatch.skillName,
        priority: topMatch.priority,
      })
    },
  }
}
