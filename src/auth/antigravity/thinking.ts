/**
 * Antigravity Thinking Block Handler (Gemini only)
 *
 * Handles extraction and transformation of thinking/reasoning blocks
 * from Gemini responses. Thinking blocks contain the model's internal
 * reasoning process, available in `-high` model variants.
 *
 * Key responsibilities:
 * - Extract thinking blocks from Gemini response format
 * - Detect thinking-capable model variants (`-high` suffix)
 * - Format thinking blocks for OpenAI-compatible output
 *
 * Note: This is Gemini-only. Claude models are NOT handled by Antigravity.
 */

/**
 * Represents a single thinking/reasoning block extracted from Gemini response
 */
export interface ThinkingBlock {
  /** The thinking/reasoning text content */
  text: string
  /** Optional signature for signed thinking blocks (required for multi-turn) */
  signature?: string
  /** Index of the thinking block in sequence */
  index?: number
}

/**
 * Raw part structure from Gemini response candidates
 */
export interface GeminiPart {
  /** Text content of the part */
  text?: string
  /** Whether this part is a thinking/reasoning block */
  thought?: boolean
  /** Signature for signed thinking blocks */
  thoughtSignature?: string
  /** Type field for Anthropic-style format */
  type?: string
  /** Signature field for Anthropic-style format */
  signature?: string
}

/**
 * Gemini response candidate structure
 */
export interface GeminiCandidate {
  /** Content containing parts */
  content?: {
    /** Role of the content (e.g., "model", "assistant") */
    role?: string
    /** Array of content parts */
    parts?: GeminiPart[]
  }
  /** Index of the candidate */
  index?: number
}

/**
 * Gemini response structure for thinking block extraction
 */
export interface GeminiResponse {
  /** Response ID */
  id?: string
  /** Array of response candidates */
  candidates?: GeminiCandidate[]
  /** Direct content (some responses use this instead of candidates) */
  content?: Array<{
    type?: string
    text?: string
    signature?: string
  }>
  /** Model used for response */
  model?: string
}

/**
 * Result of thinking block extraction
 */
export interface ThinkingExtractionResult {
  /** Extracted thinking blocks */
  thinkingBlocks: ThinkingBlock[]
  /** Combined thinking text for convenience */
  combinedThinking: string
  /** Whether any thinking blocks were found */
  hasThinking: boolean
}

/**
 * Default thinking budget in tokens for thinking-enabled models
 */
export const DEFAULT_THINKING_BUDGET = 16000

/**
 * Check if a model variant should include thinking blocks
 *
 * Returns true for model variants with `-high` suffix, which have
 * extended thinking capability enabled.
 *
 * Examples:
 * - `gemini-3-pro-high` → true
 * - `gemini-2.5-pro-high` → true
 * - `gemini-3-pro-preview` → false
 * - `gemini-2.5-pro` → false
 *
 * @param model - Model identifier string
 * @returns True if model should include thinking blocks
 */
export function shouldIncludeThinking(model: string): boolean {
  if (!model || typeof model !== "string") {
    return false
  }

  const lowerModel = model.toLowerCase()

  // Check for -high suffix (primary indicator of thinking capability)
  if (lowerModel.endsWith("-high")) {
    return true
  }

  // Also check for explicit thinking in model name
  if (lowerModel.includes("thinking")) {
    return true
  }

  return false
}

/**
 * Check if a model is thinking-capable (broader check)
 *
 * This is a broader check than shouldIncludeThinking - it detects models
 * that have thinking capability, even if not explicitly requesting thinking output.
 *
 * @param model - Model identifier string
 * @returns True if model supports thinking/reasoning
 */
export function isThinkingCapableModel(model: string): boolean {
  if (!model || typeof model !== "string") {
    return false
  }

  const lowerModel = model.toLowerCase()

  return (
    lowerModel.includes("thinking") ||
    lowerModel.includes("gemini-3") ||
    lowerModel.endsWith("-high")
  )
}

/**
 * Check if a part is a thinking/reasoning block
 *
 * Detects both Gemini-style (thought: true) and Anthropic-style
 * (type: "thinking" or type: "reasoning") formats.
 *
 * @param part - Content part to check
 * @returns True if part is a thinking block
 */
function isThinkingPart(part: GeminiPart): boolean {
  // Gemini-style: thought flag
  if (part.thought === true) {
    return true
  }

  // Anthropic-style: type field
  if (part.type === "thinking" || part.type === "reasoning") {
    return true
  }

  return false
}

/**
 * Check if a thinking part has a valid signature
 *
 * Signatures are required for multi-turn conversations with Claude models.
 * Gemini uses `thoughtSignature`, Anthropic uses `signature`.
 *
 * @param part - Thinking part to check
 * @returns True if part has valid signature
 */
function hasValidSignature(part: GeminiPart): boolean {
  // Gemini-style signature
  if (part.thought === true && part.thoughtSignature) {
    return true
  }

  // Anthropic-style signature
  if ((part.type === "thinking" || part.type === "reasoning") && part.signature) {
    return true
  }

  return false
}

/**
 * Extract thinking blocks from a Gemini response
 *
 * Parses the response structure to identify and extract all thinking/reasoning
 * content. Supports both Gemini-style (thought: true) and Anthropic-style
 * (type: "thinking") formats.
 *
 * @param response - Gemini response object
 * @returns Extraction result with thinking blocks and metadata
 */
export function extractThinkingBlocks(response: GeminiResponse): ThinkingExtractionResult {
  const thinkingBlocks: ThinkingBlock[] = []

  // Handle candidates array (standard Gemini format)
  if (response.candidates && Array.isArray(response.candidates)) {
    for (const candidate of response.candidates) {
      const parts = candidate.content?.parts
      if (!parts || !Array.isArray(parts)) {
        continue
      }

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]
        if (!part || typeof part !== "object") {
          continue
        }

        if (isThinkingPart(part)) {
          const block: ThinkingBlock = {
            text: part.text || "",
            index: thinkingBlocks.length,
          }

          // Extract signature if present
          if (part.thought === true && part.thoughtSignature) {
            block.signature = part.thoughtSignature
          } else if (part.signature) {
            block.signature = part.signature
          }

          thinkingBlocks.push(block)
        }
      }
    }
  }

  // Handle direct content array (Anthropic-style response)
  if (response.content && Array.isArray(response.content)) {
    for (let i = 0; i < response.content.length; i++) {
      const item = response.content[i]
      if (!item || typeof item !== "object") {
        continue
      }

      if (item.type === "thinking" || item.type === "reasoning") {
        thinkingBlocks.push({
          text: item.text || "",
          signature: item.signature,
          index: thinkingBlocks.length,
        })
      }
    }
  }

  // Combine all thinking text
  const combinedThinking = thinkingBlocks.map((b) => b.text).join("\n\n")

  return {
    thinkingBlocks,
    combinedThinking,
    hasThinking: thinkingBlocks.length > 0,
  }
}

/**
 * Format thinking blocks for OpenAI-compatible output
 *
 * Converts Gemini thinking block format to OpenAI's expected structure.
 * OpenAI expects thinking content as special message blocks or annotations.
 *
 * Output format:
 * ```
 * [
 *   { type: "reasoning", text: "thinking content...", signature?: "..." },
 *   ...
 * ]
 * ```
 *
 * @param thinking - Array of thinking blocks to format
 * @returns OpenAI-compatible formatted array
 */
export function formatThinkingForOpenAI(
  thinking: ThinkingBlock[],
): Array<{ type: "reasoning"; text: string; signature?: string }> {
  if (!thinking || !Array.isArray(thinking) || thinking.length === 0) {
    return []
  }

  return thinking.map((block) => {
    const formatted: { type: "reasoning"; text: string; signature?: string } = {
      type: "reasoning",
      text: block.text || "",
    }

    if (block.signature) {
      formatted.signature = block.signature
    }

    return formatted
  })
}

/**
 * Transform thinking parts in a candidate to OpenAI format
 *
 * Modifies candidate content parts to use OpenAI-style reasoning format
 * while preserving the rest of the response structure.
 *
 * @param candidate - Gemini candidate to transform
 * @returns Transformed candidate with reasoning-formatted thinking
 */
export function transformCandidateThinking(candidate: GeminiCandidate): GeminiCandidate {
  if (!candidate || typeof candidate !== "object") {
    return candidate
  }

  const content = candidate.content
  if (!content || typeof content !== "object" || !Array.isArray(content.parts)) {
    return candidate
  }

  const thinkingTexts: string[] = []
  const transformedParts = content.parts.map((part) => {
    if (part && typeof part === "object" && part.thought === true) {
      thinkingTexts.push(part.text || "")
      // Transform to reasoning format
      return {
        ...part,
        type: "reasoning" as const,
        thought: undefined, // Remove Gemini-specific field
      }
    }
    return part
  })

  const result: GeminiCandidate & { reasoning_content?: string } = {
    ...candidate,
    content: { ...content, parts: transformedParts },
  }

  // Add combined reasoning content for convenience
  if (thinkingTexts.length > 0) {
    result.reasoning_content = thinkingTexts.join("\n\n")
  }

  return result
}

/**
 * Transform Anthropic-style thinking blocks to reasoning format
 *
 * Converts `type: "thinking"` blocks to `type: "reasoning"` for consistency.
 *
 * @param content - Array of content blocks
 * @returns Transformed content array
 */
export function transformAnthropicThinking(
  content: Array<{ type?: string; text?: string; signature?: string }>,
): Array<{ type?: string; text?: string; signature?: string }> {
  if (!content || !Array.isArray(content)) {
    return content
  }

  return content.map((block) => {
    if (block && typeof block === "object" && block.type === "thinking") {
      return {
        type: "reasoning",
        text: block.text || "",
        ...(block.signature ? { signature: block.signature } : {}),
      }
    }
    return block
  })
}

/**
 * Filter out unsigned thinking blocks
 *
 * Claude API requires signed thinking blocks for multi-turn conversations.
 * This function removes thinking blocks without valid signatures.
 *
 * @param parts - Array of content parts
 * @returns Filtered array without unsigned thinking blocks
 */
export function filterUnsignedThinkingBlocks(parts: GeminiPart[]): GeminiPart[] {
  if (!parts || !Array.isArray(parts)) {
    return parts
  }

  return parts.filter((part) => {
    if (!part || typeof part !== "object") {
      return true
    }

    // If it's a thinking part, only keep it if signed
    if (isThinkingPart(part)) {
      return hasValidSignature(part)
    }

    // Keep all non-thinking parts
    return true
  })
}

/**
 * Transform entire response thinking parts
 *
 * Main transformation function that handles both Gemini-style and
 * Anthropic-style thinking blocks in a response.
 *
 * @param response - Response object to transform
 * @returns Transformed response with standardized reasoning format
 */
export function transformResponseThinking(response: GeminiResponse): GeminiResponse {
  if (!response || typeof response !== "object") {
    return response
  }

  const result: GeminiResponse = { ...response }

  // Transform candidates (Gemini-style)
  if (Array.isArray(result.candidates)) {
    result.candidates = result.candidates.map(transformCandidateThinking)
  }

  // Transform direct content (Anthropic-style)
  if (Array.isArray(result.content)) {
    result.content = transformAnthropicThinking(result.content)
  }

  return result
}

/**
 * Thinking configuration for requests
 */
export interface ThinkingConfig {
  /** Token budget for thinking/reasoning */
  thinkingBudget?: number
  /** Whether to include thoughts in response */
  includeThoughts?: boolean
}

/**
 * Normalize thinking configuration
 *
 * Ensures thinkingConfig is valid: includeThoughts only allowed when budget > 0.
 *
 * @param config - Raw thinking configuration
 * @returns Normalized configuration or undefined
 */
export function normalizeThinkingConfig(config: unknown): ThinkingConfig | undefined {
  if (!config || typeof config !== "object") {
    return undefined
  }

  const record = config as Record<string, unknown>
  const budgetRaw = record.thinkingBudget ?? record.thinking_budget
  const includeRaw = record.includeThoughts ?? record.include_thoughts

  const thinkingBudget =
    typeof budgetRaw === "number" && Number.isFinite(budgetRaw) ? budgetRaw : undefined
  const includeThoughts = typeof includeRaw === "boolean" ? includeRaw : undefined

  const enableThinking = thinkingBudget !== undefined && thinkingBudget > 0
  const finalInclude = enableThinking ? (includeThoughts ?? false) : false

  // Return undefined if no meaningful config
  if (
    !enableThinking &&
    finalInclude === false &&
    thinkingBudget === undefined &&
    includeThoughts === undefined
  ) {
    return undefined
  }

  const normalized: ThinkingConfig = {}
  if (thinkingBudget !== undefined) {
    normalized.thinkingBudget = thinkingBudget
  }
  if (finalInclude !== undefined) {
    normalized.includeThoughts = finalInclude
  }
  return normalized
}

/**
 * Extract thinking configuration from request payload
 *
 * Supports both Gemini-style thinkingConfig and Anthropic-style thinking options.
 *
 * @param requestPayload - Request body
 * @param generationConfig - Generation config from request
 * @param extraBody - Extra body options
 * @returns Extracted thinking configuration or undefined
 */
export function extractThinkingConfig(
  requestPayload: Record<string, unknown>,
  generationConfig?: Record<string, unknown>,
  extraBody?: Record<string, unknown>,
): ThinkingConfig | undefined {
  // Check for explicit thinkingConfig
  const thinkingConfig =
    generationConfig?.thinkingConfig ?? extraBody?.thinkingConfig ?? requestPayload.thinkingConfig

  if (thinkingConfig && typeof thinkingConfig === "object") {
    const config = thinkingConfig as Record<string, unknown>
    return {
      includeThoughts: Boolean(config.includeThoughts),
      thinkingBudget:
        typeof config.thinkingBudget === "number" ? config.thinkingBudget : DEFAULT_THINKING_BUDGET,
    }
  }

  // Convert Anthropic-style "thinking" option: { type: "enabled", budgetTokens: N }
  const anthropicThinking = extraBody?.thinking ?? requestPayload.thinking
  if (anthropicThinking && typeof anthropicThinking === "object") {
    const thinking = anthropicThinking as Record<string, unknown>
    if (thinking.type === "enabled" || thinking.budgetTokens) {
      return {
        includeThoughts: true,
        thinkingBudget:
          typeof thinking.budgetTokens === "number"
            ? thinking.budgetTokens
            : DEFAULT_THINKING_BUDGET,
      }
    }
  }

  return undefined
}

/**
 * Resolve final thinking configuration based on model and context
 *
 * Handles special cases like Claude models requiring signed thinking blocks
 * for multi-turn conversations.
 *
 * @param userConfig - User-provided thinking configuration
 * @param isThinkingModel - Whether model supports thinking
 * @param isClaudeModel - Whether model is Claude (not used in Antigravity, but kept for compatibility)
 * @param hasAssistantHistory - Whether conversation has assistant history
 * @returns Final thinking configuration
 */
export function resolveThinkingConfig(
  userConfig: ThinkingConfig | undefined,
  isThinkingModel: boolean,
  isClaudeModel: boolean,
  hasAssistantHistory: boolean,
): ThinkingConfig | undefined {
  // Claude models with history need signed thinking blocks
  // Since we can't guarantee signatures, disable thinking
  if (isClaudeModel && hasAssistantHistory) {
    return { includeThoughts: false, thinkingBudget: 0 }
  }

  // Enable thinking by default for thinking-capable models
  if (isThinkingModel && !userConfig) {
    return { includeThoughts: true, thinkingBudget: DEFAULT_THINKING_BUDGET }
  }

  return userConfig
}
