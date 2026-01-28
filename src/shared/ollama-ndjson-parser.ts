/**
 * Ollama NDJSON Parser
 *
 * Parses newline-delimited JSON (NDJSON) responses from Ollama API.
 *
 * @module ollama-ndjson-parser
 * @see https://github.com/code-yeongyu/oh-my-opencode/issues/1124
 * @see https://github.com/ollama/ollama/blob/main/docs/api.md
 */

import { log } from "./logger"

/**
 * Ollama message structure
 */
export interface OllamaMessage {
  tool_calls?: Array<{
    function: {
      name: string
      arguments: Record<string, unknown>
    }
  }>
  content?: string
}

/**
 * Ollama NDJSON line structure
 */
export interface OllamaNDJSONLine {
  message?: OllamaMessage
  done: boolean
  total_duration?: number
  load_duration?: number
  prompt_eval_count?: number
  prompt_eval_duration?: number
  eval_count?: number
  eval_duration?: number
}

/**
 * Merged Ollama response
 */
export interface OllamaMergedResponse {
  message: OllamaMessage
  done: boolean
  stats?: {
    total_duration?: number
    load_duration?: number
    prompt_eval_count?: number
    prompt_eval_duration?: number
    eval_count?: number
    eval_duration?: number
  }
}

/**
 * Parse Ollama streaming NDJSON response into a single merged object.
 *
 * Ollama returns streaming responses as newline-delimited JSON (NDJSON):
 * ```
 * {"message":{"tool_calls":[...]}, "done":false}
 * {"message":{"content":""}, "done":true}
 * ```
 *
 * This function:
 * 1. Splits the response by newlines
 * 2. Parses each line as JSON
 * 3. Merges tool_calls and content from all lines
 * 4. Returns a single merged response
 *
 * @param response - Raw NDJSON response string from Ollama API
 * @returns Merged response with all tool_calls and content combined
 * @throws {Error} If no valid JSON lines are found
 *
 * @example
 * ```typescript
 * const ndjsonResponse = `
 * {"message":{"tool_calls":[{"function":{"name":"read","arguments":{"filePath":"README.md"}}}]}, "done":false}
 * {"message":{"content":""}, "done":true}
 * `;
 *
 * const merged = parseOllamaStreamResponse(ndjsonResponse);
 * // Result:
 * // {
 * //   message: {
 * //     tool_calls: [{ function: { name: "read", arguments: { filePath: "README.md" } } }],
 * //     content: ""
 * //   },
 * //   done: true
 * // }
 * ```
 */
export function parseOllamaStreamResponse(response: string): OllamaMergedResponse {
  const lines = response.split("\n").filter((line) => line.trim())

  if (lines.length === 0) {
    throw new Error("No valid NDJSON lines found in response")
  }

  const mergedMessage: OllamaMessage = {
    tool_calls: [],
    content: "",
  }

  let done = false
  let stats: OllamaMergedResponse["stats"] = {}

  for (const line of lines) {
    try {
      const json = JSON.parse(line) as OllamaNDJSONLine

      // Merge tool_calls
      if (json.message?.tool_calls) {
        mergedMessage.tool_calls = [
          ...(mergedMessage.tool_calls || []),
          ...json.message.tool_calls,
        ]
      }

      // Merge content (concatenate)
      if (json.message?.content) {
        mergedMessage.content = (mergedMessage.content || "") + json.message.content
      }

      // Update done flag (final line has done: true)
      if (json.done) {
        done = true

        // Capture stats from final line
        stats = {
          total_duration: json.total_duration,
          load_duration: json.load_duration,
          prompt_eval_count: json.prompt_eval_count,
          prompt_eval_duration: json.prompt_eval_duration,
          eval_count: json.eval_count,
          eval_duration: json.eval_duration,
        }
      }
    } catch (error) {
      log(`[ollama-ndjson-parser] Skipping malformed NDJSON line: ${line}`, { error })
      continue
    }
  }

  return {
    message: mergedMessage,
    done,
    ...(Object.keys(stats).length > 0 ? { stats } : {}),
  }
}

/**
 * Check if a response string is NDJSON format.
 *
 * NDJSON is identified by:
 * - Multiple lines
 * - Each line is valid JSON
 * - At least one line has "done" field
 *
 * @param response - Response string to check
 * @returns true if response appears to be NDJSON
 *
 * @example
 * ```typescript
 * const ndjson = '{"done":false}\n{"done":true}';
 * const singleJson = '{"done":true}';
 *
 * isNDJSONResponse(ndjson);     // true
 * isNDJSONResponse(singleJson); // false
 * ```
 */
export function isNDJSONResponse(response: string): boolean {
  const lines = response.split("\n").filter((line) => line.trim())

  // Single line is not NDJSON
  if (lines.length <= 1) {
    return false
  }

  let hasValidJSON = false
  let hasDoneField = false

  for (const line of lines) {
    try {
      const json = JSON.parse(line) as Record<string, unknown>
      hasValidJSON = true

      if ("done" in json) {
        hasDoneField = true
      }
    } catch {
      // If any line fails to parse, it's not NDJSON
      return false
    }
  }

  return hasValidJSON && hasDoneField
}
