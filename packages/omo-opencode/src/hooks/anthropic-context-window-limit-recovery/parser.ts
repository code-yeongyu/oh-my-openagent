import { isRecord } from "@oh-my-opencode/utils"
import type { ParsedTokenLimitError } from "./types"

interface AnthropicErrorData {
  type?: "error"
  error: {
    type?: string
    message: string
  }
  request_id?: string
}

const TOKEN_LIMIT_PATTERNS = [
  /(\d+)\s*tokens?\s*>\s*(\d+)\s*maximum/i,
  /prompt.*?(\d+).*?tokens.*?exceeds.*?(\d+)/i,
  /(\d+).*?tokens.*?limit.*?(\d+)/i,
  /context.*?length.*?(\d+).*?maximum.*?(\d+)/i,
  /max.*?context.*?(\d+).*?but.*?(\d+)/i,
]

const TOKEN_LIMIT_KEYWORDS = [
  "prompt is too long",
  "is too long",
  "context_length_exceeded",
  "max_tokens",
  "token limit",
  "context length",
  "too many tokens",
  "non-empty content",
]

// Patterns that indicate thinking block structure errors (NOT token limit errors);
// compaction must not react to them
const THINKING_BLOCK_ERROR_PATTERNS = [
  /thinking.*first block/i,
  /first block.*thinking/i,
  /must.*start.*thinking/i,
  /thinking.*redacted_thinking/i,
  /expected.*thinking.*found/i,
  /thinking.*disabled.*cannot.*contain/i,
]

function isThinkingBlockError(text: string): boolean {
  return THINKING_BLOCK_ERROR_PATTERNS.some((pattern) => pattern.test(text))
}

const MESSAGE_INDEX_PATTERN = /messages\.(\d+)/



function readProperty(source: Record<string, unknown>, key: string): unknown | undefined {
  try {
    return source[key]
  } catch (error) {
    if (error instanceof Error) {
      return undefined
    }
    return undefined
  }
}

function readStringProperty(source: Record<string, unknown>, key: string): string | undefined {
  const value = readProperty(source, key)
  return typeof value === "string" ? value : undefined
}

function isAnthropicErrorData(value: unknown): value is AnthropicErrorData {
  if (!isRecord(value)) {
    return false
  }

  const error = readProperty(value, "error")
  if (!isRecord(error)) {
    return false
  }

  const requestId = readProperty(value, "request_id")
  return typeof readProperty(error, "message") === "string" && (requestId === undefined || typeof requestId === "string")
}

function extractTokensFromMessage(message: string): { current: number; max: number } | null {
  for (const pattern of TOKEN_LIMIT_PATTERNS) {
    const match = message.match(pattern)
    if (match) {
      const num1 = parseInt(match[1], 10)
      const num2 = parseInt(match[2], 10)
      return num1 > num2 ? { current: num1, max: num2 } : { current: num2, max: num1 }
    }
  }
  return null
}

function extractMessageIndex(text: string): number | undefined {
  const match = text.match(MESSAGE_INDEX_PATTERN)
  if (match) {
    return parseInt(match[1], 10)
  }
  return undefined
}

function isTokenLimitError(text: string): boolean {
  if (isThinkingBlockError(text)) {
    return false
  }
  const lower = text.toLowerCase()
  return TOKEN_LIMIT_KEYWORDS.some((kw) => lower.includes(kw))
}

function stringifyErrorObject(errObj: Record<string, unknown>): string | null {
  try {
    return JSON.stringify(errObj) ?? null
  } catch (error) {
    if (error instanceof Error) {
      return null
    }
    return null
  }
}

function parseJsonOrNull(text: string): unknown | null {
  try {
    return JSON.parse(text)
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null
    }
    throw error
  }
}

export function parseAnthropicTokenLimitError(err: unknown): ParsedTokenLimitError | null {
  if (typeof err === "string") {
    if (err.toLowerCase().includes("non-empty content")) {
      return {
        currentTokens: 0,
        maxTokens: 0,
        errorType: "non-empty content",
        messageIndex: extractMessageIndex(err),
      }
    }
    if (isTokenLimitError(err)) {
      const tokens = extractTokensFromMessage(err)
      return {
        currentTokens: tokens?.current ?? 0,
        maxTokens: tokens?.max ?? 0,
        errorType: "token_limit_exceeded_string",
      }
    }
    return null
  }

  if (!isRecord(err)) return null

  const errObj = err

  const data = readProperty(errObj, "data")
  const dataObj = isRecord(data) ? data : undefined
  const responseBody = dataObj ? readProperty(dataObj, "responseBody") : undefined
  const errorMessage = readStringProperty(errObj, "message")
  const errorValue = readProperty(errObj, "error")
  const errorData = isRecord(errorValue) ? errorValue : undefined
  const nestedErrorValue = errorData ? readProperty(errorData, "error") : undefined
  const nestedError = isRecord(nestedErrorValue) ? nestedErrorValue : undefined

  const textSources: string[] = []

  if (typeof responseBody === "string") textSources.push(responseBody)
  if (typeof errorMessage === "string") textSources.push(errorMessage)
  const errorDataMessage = errorData ? readStringProperty(errorData, "message") : undefined
  if (errorDataMessage !== undefined) textSources.push(errorDataMessage)
  const body = readStringProperty(errObj, "body")
  if (body !== undefined) textSources.push(body)
  const details = readStringProperty(errObj, "details")
  if (details !== undefined) textSources.push(details)
  const reason = readStringProperty(errObj, "reason")
  if (reason !== undefined) textSources.push(reason)
  const description = readStringProperty(errObj, "description")
  if (description !== undefined) textSources.push(description)
  const nestedErrorMessage = nestedError ? readStringProperty(nestedError, "message") : undefined
  if (nestedErrorMessage !== undefined) textSources.push(nestedErrorMessage)
  const dataMessage = dataObj ? readStringProperty(dataObj, "message") : undefined
  if (dataMessage !== undefined) textSources.push(dataMessage)
  const dataError = dataObj ? readStringProperty(dataObj, "error") : undefined
  if (dataError !== undefined) textSources.push(dataError)

  if (textSources.length === 0) {
    const jsonStr = stringifyErrorObject(errObj)
    if (jsonStr !== null && isTokenLimitError(jsonStr)) {
      textSources.push(jsonStr)
    }
  }

  const combinedText = textSources.join(" ")
  if (!isTokenLimitError(combinedText)) return null

  if (typeof responseBody === "string") {
    const jsonPatterns = [
      // Greedy match to last } for nested JSON
      /data:\s*(\{[\s\S]*\})\s*$/m,
      /(\{"type"\s*:\s*"error"[\s\S]*\})/,
      /(\{[\s\S]*"error"[\s\S]*\})/,
    ]

    for (const pattern of jsonPatterns) {
      const dataMatch = responseBody.match(pattern)
      const jsonText = dataMatch?.[1]
      if (jsonText !== undefined) {
        const jsonData = parseJsonOrNull(jsonText)
        if (!isAnthropicErrorData(jsonData)) {
          continue
        }
        const message = jsonData?.error?.message || ""
        const tokens = extractTokensFromMessage(message)

        if (tokens) {
          return {
            currentTokens: tokens.current,
            maxTokens: tokens.max,
            requestId: jsonData?.request_id,
            errorType: jsonData?.error?.type || "token_limit_exceeded",
          }
        }
      }
    }

    const bedrockJson = parseJsonOrNull(responseBody)
    const bedrockMessage = isRecord(bedrockJson) ? readStringProperty(bedrockJson, "message") : undefined
    if (bedrockMessage !== undefined && isTokenLimitError(bedrockMessage)) {
      return {
        currentTokens: 0,
        maxTokens: 0,
        errorType: "bedrock_input_too_long",
      }
    }
  }

  for (const text of textSources) {
    const tokens = extractTokensFromMessage(text)
    if (tokens) {
      return {
        currentTokens: tokens.current,
        maxTokens: tokens.max,
        errorType: "token_limit_exceeded",
      }
    }
  }

  if (combinedText.toLowerCase().includes("non-empty content")) {
    return {
      currentTokens: 0,
      maxTokens: 0,
      errorType: "non-empty content",
      messageIndex: extractMessageIndex(combinedText),
    }
  }

  if (isTokenLimitError(combinedText)) {
    return {
      currentTokens: 0,
      maxTokens: 0,
      errorType: "token_limit_exceeded_unknown",
    }
  }

  return null
}
