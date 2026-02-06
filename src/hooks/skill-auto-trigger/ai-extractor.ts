import type { PluginInput } from "@opencode-ai/plugin"
import type { LoadedSkill } from "../../features/opencode-skill-loader/types"
import type { SkillTriggerCache, SkillTrigger, CachedSkillTrigger } from "./types"
import { SCOPE_PRIORITY, HOOK_NAME } from "./types"
import { saveCache } from "./cache-storage"
import { hashDescription } from "./cache-checker"
import { buildExtractionPrompt, parseAIResponse, batchSkills } from "./trigger-extractor"
import { log, promptWithModelSuggestionRetry } from "../../shared"

type OpencodeClient = PluginInput["client"]

/**
 * Model configuration for AI extraction.
 * Uses a fast, cheap model for keyword extraction.
 */
const EXTRACTION_MODEL = {
  providerID: "anthropic",
  modelID: "claude-haiku-4-5"
}

/**
 * Polling configuration for AI response.
 */
const POLL_INTERVAL_MS = 500
const MAX_POLL_TIME_MS = 30000

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
 * Polls a session for assistant response text.
 * Returns the text content when the session becomes idle.
 */
async function pollForResponse(
  client: OpencodeClient,
  sessionID: string,
  directory: string
): Promise<string> {
  const startTime = Date.now()
  
  while (Date.now() - startTime < MAX_POLL_TIME_MS) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
    
    try {
      // Use session.messages API (not message.list)
      const messagesResult = await (client.session as unknown as {
        messages: (opts: { path: { id: string }; query?: { directory?: string } }) => Promise<unknown>
      }).messages({
        path: { id: sessionID },
        query: { directory }
      })
      
      if (!messagesResult) {
        continue
      }
      
      // Find the last assistant message
      const messages = messagesResult as Array<{
        role?: string
        parts?: Array<{ type: string; text?: string }>
      }>
      
      const assistantMessages = messages.filter(m => m.role === "assistant")
      if (assistantMessages.length === 0) {
        continue
      }
      
      const lastAssistant = assistantMessages[assistantMessages.length - 1]
      const textParts = lastAssistant.parts?.filter(p => p.type === "text" && p.text) || []
      const responseText = textParts.map(p => p.text).join("")
      
      // Check if response looks complete (has JSON structure)
      if (responseText.includes("{") && responseText.includes("}")) {
        return responseText
      }
    } catch (err) {
      log(`[${HOOK_NAME}] Poll error`, { error: String(err) })
    }
  }
  
  throw new Error("Timeout waiting for AI response")
}

/**
 * Extracts triggers from skills using AI.
 * Creates a temporary session, sends extraction prompt, and parses response.
 * 
 * @param ctx - Plugin input containing client and directory
 * @param skills - Skills to extract triggers from
 * @returns Extracted triggers as Record<skillName, keywords[]>
 */
export async function extractTriggersWithAI(
  ctx: PluginInput,
  skills: LoadedSkill[]
): Promise<Record<string, string[]>> {
  const prompt = buildExtractionPrompt(skills)
  
  // Create temporary session for extraction
  const createResult = await ctx.client.session.create({
    body: {
      title: "[skill-auto-trigger] AI Extraction",
      permission: [
        { permission: "question", action: "deny" as const, pattern: "*" }
      ]
    } as Record<string, unknown>,
    query: { directory: ctx.directory }
  })
  
  if (createResult.error || !createResult.data?.id) {
    throw new Error(`Failed to create extraction session: ${createResult.error}`)
  }
  
  const sessionID = createResult.data.id
  
  try {
    // Send extraction prompt
    await promptWithModelSuggestionRetry(ctx.client, {
      path: { id: sessionID },
      body: {
        model: EXTRACTION_MODEL,
        parts: [{ type: "text", text: prompt }],
        tools: {} // No tools needed for extraction
      }
    })
    
    // Poll for response
    const responseText = await pollForResponse(ctx.client, sessionID, ctx.directory)
    
    // Parse AI response
    return parseAIResponse(responseText)
  } finally {
    // Clean up session
    await ctx.client.session.delete({
      path: { id: sessionID }
    }).catch(() => {})
  }
}

/**
 * Triggers background AI extraction of skill triggers.
 * Processes skills in batches, updates cache, and returns built triggers.
 * 
 * This function is designed to be called after the first user message,
 * running in the background without blocking the main flow.
 * 
 * @param ctx - Plugin input containing client and directory
 * @param skills - All loaded skills to process
 * @param currentCache - Current cache state
 * @returns Array of SkillTrigger objects for matching
 */
export async function triggerBackgroundExtraction(
  ctx: PluginInput,
  skills: LoadedSkill[],
  currentCache: SkillTriggerCache
): Promise<SkillTrigger[]> {
  const batches = batchSkills(skills)
  const newCacheSkills: Record<string, CachedSkillTrigger> = { ...currentCache.skills }
  
  for (const batch of batches) {
    try {
      const extracted = await extractTriggersWithAI(ctx, batch)
      
      // Merge to cache
      for (const skill of batch) {
        const description = skill.definition?.description
        if (!description) continue
        const triggers = extracted[skill.name]
        if (!triggers || triggers.length === 0) continue
        
        const scope = skill.scope as "builtin" | "opencode-project" | "opencode" | "user" | "project" | "config"
        newCacheSkills[skill.name] = {
          hash: hashDescription(description),
          triggers,
          priority: SCOPE_PRIORITY[scope] ?? 0,
          scope
        }
      }
      
      log(`[${HOOK_NAME}] Extracted triggers for batch of ${batch.length} skills`)
    } catch (err) {
      log(`[${HOOK_NAME}] Batch extraction failed`, { error: String(err) })
      // Continue with next batch even if one fails
    }
  }
  
  // Save updated cache
  const newCache: SkillTriggerCache = {
    version: "1.0",
    generatedAt: new Date().toISOString(),
    skills: newCacheSkills
  }
  saveCache(newCache)
  
  log(`[${HOOK_NAME}] Background extraction complete, saved ${Object.keys(newCacheSkills).length} skills to cache`)
  
  // Return built triggers
  return buildTriggersFromCache(newCache, skills)
}
