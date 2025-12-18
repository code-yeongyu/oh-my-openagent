import type { ParsedTokenLimitError } from "./types"

interface AnthropicErrorData {
  type: "error"
  error: {
    type: string
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

function isTokenLimitError(text: string): boolean {
  const lower = text.toLowerCase()
  return TOKEN_LIMIT_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()))
}

export function parseAnthropicTokenLimitError(err: unknown): ParsedTokenLimitError | null {
  if (typeof err === "string") {
    if (err.toLowerCase().includes("non-empty content")) {
      return {
        currentTokens: 0,
        maxTokens: 0,
        errorType: "non-empty content",
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

  if (!err || typeof err !== "object") return null

  const errObj = err as Record<string, unknown>

  const dataObj = errObj.data as Record<string, unknown> | undefined
  const responseBody = dataObj?.responseBody
  const errorMessage = errObj.message as string | undefined
  const errorData = errObj.error as Record<string, unknown> | undefined
  const nestedError = errorData?.error as Record<string, unknown> | undefined

  const textSources: string[] = []

  if (typeof responseBody === "string") textSources.push(responseBody)
  if (typeof errorMessage === "string") textSources.push(errorMessage)
  if (typeof errorData?.message === "string") textSources.push(errorData.message as string)
  if (typeof errObj.body === "string") textSources.push(errObj.body as string)
  if (typeof errObj.details === "string") textSources.push(errObj.details as string)
  if (typeof errObj.reason === "string") textSources.push(errObj.reason as string)
  if (typeof errObj.description === "string") textSources.push(errObj.description as string)
  if (typeof nestedError?.message === "string") textSources.push(nestedError.message as string)
  if (typeof dataObj?.message === "string") textSources.push(dataObj.message as string)
  if (typeof dataObj?.error === "string") textSources.push(dataObj.error as string)

  if (textSources.length === 0) {
    try {
      const jsonStr = JSON.stringify(errObj)
      if (isTokenLimitError(jsonStr)) {
        textSources.push(jsonStr)
      }
    } catch {}
  }

  const combinedText = textSources.join(" ")
  if (!isTokenLimitError(combinedText)) return null

  if (typeof responseBody === "string") {
    try {
      const jsonPatterns = [
        /data:\s*(\{[\s\S]*?\})\s*$/m,
        /(\{"type"\s*:\s*"error"[\s\S]*?\})/,
        /(\{[\s\S]*?"error"[\s\S]*?\})/,
      ]

      for (const pattern of jsonPatterns) {
        const dataMatch = responseBody.match(pattern)
        if (dataMatch) {
          try {
            const jsonData: AnthropicErrorData = JSON.parse(dataMatch[1])
            const message = jsonData.error?.message || ""
            const tokens = extractTokensFromMessage(message)

            if (tokens) {
              return {
                currentTokens: tokens.current,
                maxTokens: tokens.max,
                requestId: jsonData.request_id,
                errorType: jsonData.error?.type || "token_limit_exceeded",
              }
            }
          } catch {}
        }
      }

      const bedrockJson = JSON.parse(responseBody)
      if (typeof bedrockJson.message === "string" && isTokenLimitError(bedrockJson.message)) {
        return {
          currentTokens: 0,
          maxTokens: 0,
          errorType: "bedrock_input_too_long",
        }
      }
    } catch {}
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
