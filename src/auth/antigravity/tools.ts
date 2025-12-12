/**
 * Antigravity Tool Normalization
 * Converts tools between OpenAI and Gemini formats.
 *
 * OpenAI format:
 *   { "type": "function", "function": { "name": "x", "description": "...", "parameters": {...} } }
 *
 * Gemini format:
 *   { "functionDeclarations": [{ "name": "x", "description": "...", "parameters": {...} }] }
 *
 * Note: This is for Gemini models ONLY. Claude models are not supported via Antigravity.
 */

/**
 * OpenAI function tool format
 */
export interface OpenAITool {
  type: string
  function?: {
    name: string
    description?: string
    parameters?: Record<string, unknown>
  }
}

/**
 * Gemini function declaration format
 */
export interface GeminiFunctionDeclaration {
  name: string
  description?: string
  parameters?: Record<string, unknown>
}

/**
 * Gemini tools format (array of functionDeclarations)
 */
export interface GeminiTools {
  functionDeclarations: GeminiFunctionDeclaration[]
}

/**
 * OpenAI tool call in response
 */
export interface OpenAIToolCall {
  id: string
  type: "function"
  function: {
    name: string
    arguments: string
  }
}

/**
 * Gemini function call in response
 */
export interface GeminiFunctionCall {
  name: string
  args: Record<string, unknown>
}

/**
 * Gemini function response format
 */
export interface GeminiFunctionResponse {
  name: string
  response: Record<string, unknown>
}

/**
 * Gemini tool result containing function calls
 */
export interface GeminiToolResult {
  functionCall?: GeminiFunctionCall
  functionResponse?: GeminiFunctionResponse
}

/**
 * Normalize OpenAI-format tools to Gemini format.
 * Converts an array of OpenAI tools to Gemini's functionDeclarations format.
 *
 * - Handles `function` type tools with name, description, parameters
 * - Logs warning for unsupported tool types (does NOT silently drop them)
 * - Creates a single object with functionDeclarations array
 *
 * @param tools - Array of OpenAI-format tools
 * @returns Gemini-format tools object with functionDeclarations, or undefined if no valid tools
 */
export function normalizeToolsForGemini(
  tools: OpenAITool[]
): GeminiTools | undefined {
  if (!tools || tools.length === 0) {
    return undefined
  }

  const functionDeclarations: GeminiFunctionDeclaration[] = []

  for (const tool of tools) {
    // Handle function type tools
    if (tool.type === "function" && tool.function) {
      const declaration: GeminiFunctionDeclaration = {
        name: tool.function.name,
      }

      // Include description if present
      if (tool.function.description) {
        declaration.description = tool.function.description
      }

      // Include parameters if present, default to empty object schema
      if (tool.function.parameters) {
        declaration.parameters = tool.function.parameters
      } else {
        // Gemini requires parameters field, use empty object as default
        declaration.parameters = { type: "object", properties: {} }
      }

      functionDeclarations.push(declaration)
    } else {
      // Log warning for unsupported tool types (debug only)
      if (process.env.ANTIGRAVITY_DEBUG === "1") {
        console.warn(
          `[antigravity-tools] Unsupported tool type: "${tool.type}". ` +
            `Only "function" type tools are supported for Gemini. Tool will be skipped.`
        )
      }
    }
  }

  // Return undefined if no valid function declarations
  if (functionDeclarations.length === 0) {
    return undefined
  }

  return { functionDeclarations }
}

/**
 * Convert Gemini tool results (functionCall) back to OpenAI tool_call format.
 * Handles both functionCall (request) and functionResponse (result) formats.
 *
 * Gemini functionCall format:
 *   { "name": "tool_name", "args": { ... } }
 *
 * OpenAI tool_call format:
 *   { "id": "call_xxx", "type": "function", "function": { "name": "tool_name", "arguments": "..." } }
 *
 * @param results - Array of Gemini tool results containing functionCall or functionResponse
 * @returns Array of OpenAI-format tool calls
 */
export function normalizeToolResultsFromGemini(
  results: GeminiToolResult[]
): OpenAIToolCall[] {
  if (!results || results.length === 0) {
    return []
  }

  const toolCalls: OpenAIToolCall[] = []
  let callCounter = 0

  for (const result of results) {
    // Handle functionCall (tool invocation from model)
    if (result.functionCall) {
      callCounter++
      const toolCall: OpenAIToolCall = {
        id: `call_${Date.now()}_${callCounter}`,
        type: "function",
        function: {
          name: result.functionCall.name,
          arguments: JSON.stringify(result.functionCall.args ?? {}),
        },
      }
      toolCalls.push(toolCall)
    }
  }

  return toolCalls
}

/**
 * Convert a single Gemini functionCall to OpenAI tool_call format.
 * Useful for streaming responses where each chunk may contain a function call.
 *
 * @param functionCall - Gemini function call
 * @param id - Optional tool call ID (generates one if not provided)
 * @returns OpenAI-format tool call
 */
export function convertFunctionCallToToolCall(
  functionCall: GeminiFunctionCall,
  id?: string
): OpenAIToolCall {
  return {
    id: id ?? `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: "function",
    function: {
      name: functionCall.name,
      arguments: JSON.stringify(functionCall.args ?? {}),
    },
  }
}

/**
 * Check if a tool array contains any function-type tools.
 *
 * @param tools - Array of OpenAI-format tools
 * @returns true if there are function tools to normalize
 */
export function hasFunctionTools(tools: OpenAITool[]): boolean {
  if (!tools || tools.length === 0) {
    return false
  }

  return tools.some((tool) => tool.type === "function" && tool.function)
}

/**
 * Extract function declarations from already-normalized Gemini tools.
 * Useful when tools may already be in Gemini format.
 *
 * @param tools - Tools that may be in Gemini or OpenAI format
 * @returns Array of function declarations
 */
export function extractFunctionDeclarations(
  tools: unknown
): GeminiFunctionDeclaration[] {
  if (!tools || typeof tools !== "object") {
    return []
  }

  // Check if already in Gemini format
  const geminiTools = tools as Record<string, unknown>
  if (
    Array.isArray(geminiTools.functionDeclarations) &&
    geminiTools.functionDeclarations.length > 0
  ) {
    return geminiTools.functionDeclarations as GeminiFunctionDeclaration[]
  }

  // Check if it's an array of OpenAI tools
  if (Array.isArray(tools)) {
    const normalized = normalizeToolsForGemini(tools as OpenAITool[])
    return normalized?.functionDeclarations ?? []
  }

  return []
}
