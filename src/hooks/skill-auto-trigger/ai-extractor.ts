import type { PluginInput } from "@opencode-ai/plugin"
import type { LoadedSkill } from "../../features/opencode-skill-loader/types"
import type { SkillTriggerCache, SkillTrigger, CachedSkillTrigger } from "./types"
import { HOOK_NAME } from "./types"
import { saveCache } from "./cache-storage"
import { buildExtractionPrompt, parseAIResponse, batchSkills, buildCachedTriggers } from "./trigger-extractor"
import { buildTriggerRegex } from "./keyword-extractor"
import {
  log,
  promptWithModelSuggestionRetry,
  fetchAvailableModels,
  resolveModelWithFallback,
  CATEGORY_MODEL_REQUIREMENTS
} from "../../shared"

type OpencodeClient = PluginInput["client"]

/**
 * Polling configuration for AI response.
 */
const POLL_INTERVAL_MS = 1000
const MAX_POLL_TIME_MS = 120000

type ProviderModelSelection = {
  providerID: string
  modelID: string
}

function parseProviderModel(model: string): ProviderModelSelection | null {
  const [providerID, ...modelParts] = model.split("/")
  if (!providerID || modelParts.length === 0) {
    return null
  }
  return {
    providerID,
    modelID: modelParts.join("/")
  }
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
    const regex = buildTriggerRegex(cached.triggers)
    if (!regex) continue
    triggers.push({
      skillName: skill.name,
      description: skill.definition?.description || "",
      keywords: regex,
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
  sessionID: string
): Promise<string> {
  const startTime = Date.now()
  
  while (Date.now() - startTime < MAX_POLL_TIME_MS) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
    
    try {
      // Use session.messages API - same pattern as other parts of codebase
      const messagesResult = await client.session.messages({
        path: { id: sessionID }
      })
      
      const messagesPayload = Array.isArray(messagesResult)
        ? messagesResult
        : (messagesResult as { data?: unknown })?.data
      const messagesData = Array.isArray(messagesPayload)
        ? messagesPayload
        : (messagesPayload as { messages?: unknown })?.messages
      if (!Array.isArray(messagesData)) {
        continue
      }
      
      // Find the last assistant message
      const messages = messagesData as Array<{
        role?: string
        parts?: Array<{ type: string; text?: string; output?: string; thinking?: string }>
        info?: { role?: string }
      }>
      
      const assistantMessages = messages.filter(
        (m) => (m.role ?? m.info?.role) === "assistant" || (m.role ?? m.info?.role) === "tool"
      )
      if (assistantMessages.length === 0) {
        continue
      }
      
      const lastAssistant = assistantMessages[assistantMessages.length - 1]
      const responseText = (lastAssistant.parts || [])
        .map((part) => {
          if ((part.type === "text" || part.type === "reasoning") && typeof part.text === "string") {
            return part.text
          }
          if (part.type === "tool_result") {
            const content = (part as { content?: unknown }).content
            if (typeof content === "string") return content
            if (Array.isArray(content)) return content.join("\n")
          }
          if (typeof part.output === "string" && part.output.trim()) return part.output
          if (typeof part.thinking === "string" && part.thinking.trim()) return part.thinking
          return ""
        })
        .filter((value) => value.trim().length > 0)
        .join("\n")
      
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
  skills: LoadedSkill[],
  parentSessionID: string
): Promise<Record<string, string[]>> {
  const prompt = buildExtractionPrompt(skills)
  const availableModels = await fetchAvailableModels(ctx.client)
  const resolvedModel = resolveModelWithFallback({
    fallbackChain: CATEGORY_MODEL_REQUIREMENTS.quick.fallbackChain,
    availableModels
  })
  const extractionModel = resolvedModel
    ? parseProviderModel(resolvedModel.model)
    : null

  if (resolvedModel) {
    log(`[${HOOK_NAME}] Resolved extraction model`, {
      model: resolvedModel.model,
      source: resolvedModel.source
    })
  }

  if (!extractionModel) {
    log(`[${HOOK_NAME}] No extraction model resolved, omitting model override`)
  }
  
  // Create temporary session for extraction
  const createResult = await ctx.client.session.create({
    body: {
      parentID: parentSessionID,
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
    const promptBody: Record<string, unknown> = {
      parts: [{ type: "text", text: prompt }],
      agent: "sisyphus-junior"
    }
    if (extractionModel) {
      promptBody.model = extractionModel
    }
    log("[skill-auto-trigger] Sending extraction prompt", {
      sessionID,
      batchSize: skills.length
    })
    let promptSent = false
    try {
      await promptWithModelSuggestionRetry(ctx.client, {
        path: { id: sessionID },
        body: {
          ...promptBody
        } as Record<string, unknown>,
        query: { directory: ctx.directory }
      })
      promptSent = true
    } catch (err) {
      const errorMessage = String(err)
      if (!extractionModel) {
        if (errorMessage.includes("Unexpected EOF")) {
          log("[skill-auto-trigger] Prompt error but continuing to poll", {
            sessionID,
            error: errorMessage
          })
          promptSent = true
        } else {
          throw err
        }
      } else {
        log("[skill-auto-trigger] Prompt failed with model override, retrying without model", {
          sessionID,
          error: errorMessage
        })

        const fallbackBody: { parts: Array<{ type: "text"; text: string }>; agent: string } = {
          parts: [{ type: "text", text: prompt }],
          agent: "sisyphus-junior"
        }

        try {
          await ctx.client.session.prompt({
            path: { id: sessionID },
            body: fallbackBody,
            query: { directory: ctx.directory }
          })
          promptSent = true
        } catch (fallbackErr) {
          const fallbackMessage = String(fallbackErr)
          if (fallbackMessage.includes("Unexpected EOF")) {
            log("[skill-auto-trigger] Prompt error after fallback, continuing to poll", {
              sessionID,
              error: fallbackMessage
            })
            promptSent = true
          } else {
            throw fallbackErr
          }
        }
      }
    }
    
    // Poll for response
    if (!promptSent) {
      throw new Error("Extraction prompt was not sent")
    }

    const responseText = await pollForResponse(ctx.client, sessionID)
    
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
  currentCache: SkillTriggerCache,
  parentSessionID: string,
  extractFn: typeof extractTriggersWithAI = extractTriggersWithAI
): Promise<SkillTrigger[]> {
  const batches = batchSkills(skills)
  const newCacheSkills: Record<string, CachedSkillTrigger> = { ...currentCache.skills }
  
  for (const batch of batches) {
    try {
      const extracted = await extractFn(ctx, batch, parentSessionID)
      const batchCache = buildCachedTriggers(batch, extracted)

      for (const [skillName, cached] of Object.entries(batchCache)) {
        newCacheSkills[skillName] = cached
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
