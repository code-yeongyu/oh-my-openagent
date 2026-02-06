import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared"
import { generateDynamicTriggers, findMatchingTriggers } from "./trigger-generator"
import { HOOK_NAME, type SkillTrigger, type SkillTriggerCache } from "./types"
import { loadCache, saveCache } from "./cache-storage"
import { checkForUpdates, hashDescription } from "./cache-checker"
import { buildExtractionPrompt, parseAIResponse, buildCachedTriggers, batchSkills } from "./trigger-extractor"
import { getAllSkills } from "../../features/opencode-skill-loader/skill-content"
import type { LoadedSkill } from "../../features/opencode-skill-loader/types"

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
 * Builds SkillTrigger array from cached data.
 * Converts cached triggers to the format used by findMatchingTriggers.
 */
function buildTriggersFromCache(cache: SkillTriggerCache, skills: LoadedSkill[]): SkillTrigger[] {
  const triggers: SkillTrigger[] = []
  for (const skill of skills) {
    const cached = cache.skills[skill.name]
    if (!cached) continue
    const pattern = cached.triggers.map(t => `\\b${t}\\b`).join('|')
    triggers.push({
      skillName: skill.name,
      description: skill.definition?.description || '',
      keywords: new RegExp(pattern, 'i'),
      priority: cached.priority,
      scope: cached.scope
    })
  }
  return triggers.sort((a, b) => b.priority - a.priority)
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

  // Initialize triggers asynchronously with cache support
  const initPromise = (async () => {
    try {
      // Load cache and get all skills
      const cache = loadCache()
      const allSkills = await getAllSkills()
      
      // Check for updates
      const updateResult = checkForUpdates(cache, allSkills)
      
      if (updateResult.hasUpdates) {
        // Log what needs updating (AI extraction is out of scope for now)
        log(`[${HOOK_NAME}] Cache update needed: ${updateResult.newSkills.length} new, ${updateResult.changedSkills.length} changed, ${updateResult.deletedSkills.length} deleted`)
        
        // Fall back to regex-based triggers until AI extraction is implemented
        dynamicTriggers = await generateDynamicTriggers()
        log(`[${HOOK_NAME}] Using fallback: ${dynamicTriggers.length} dynamic skill triggers`)
      } else if (Object.keys(cache.skills).length > 0) {
        // Cache is valid and has skills - build triggers from cache
        dynamicTriggers = buildTriggersFromCache(cache, allSkills)
        log(`[${HOOK_NAME}] Loaded ${dynamicTriggers.length} cached skill triggers`)
      } else {
        // Empty cache, no updates detected - use fallback
        dynamicTriggers = await generateDynamicTriggers()
        log(`[${HOOK_NAME}] Using fallback: ${dynamicTriggers.length} dynamic skill triggers`)
      }
      
      initialized = true
    } catch (err) {
      log(`[${HOOK_NAME}] Failed to load triggers`, { error: String(err) })
      // Try fallback on error
      try {
        dynamicTriggers = await generateDynamicTriggers()
        initialized = true
        log(`[${HOOK_NAME}] Fallback loaded ${dynamicTriggers.length} triggers after error`)
      } catch (fallbackErr) {
        log(`[${HOOK_NAME}] Fallback also failed`, { error: String(fallbackErr) })
      }
    }
  })()

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
