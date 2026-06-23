import { MNEMOSYNE_CURATOR_PROMPT } from "./curator-prompt"
import type { CuratorResponse } from "./types"
import { parseCuratorResponse } from "./response-parser"

export interface CuratorInvokerInput {
  recent_memories: unknown[]
  related_memories: unknown[]
  project_id: string
  batch_size_hint: number
}

export interface CuratorInvoker {
  invoke(input: CuratorInvokerInput): Promise<CuratorResponse>
}

export interface HttpCuratorInvokerDeps {
  baseUrl?: string
  model?: string
  fallbackModel?: string
  authToken?: string
  requestTimeoutMs?: number
  fetchImpl?: typeof fetch
  log?: (message: string, ...args: unknown[]) => void
}

const DEFAULT_BASE_URL = "http://127.0.0.1:37999/v1/chat/completions"
const DEFAULT_MODEL = "gemini-2.5-flash"
const DEFAULT_TIMEOUT_MS = 45_000

export class CuratorInvokerError extends Error {
  constructor(message: string, public readonly raw?: string) {
    super(message)
    this.name = "CuratorInvokerError"
  }
}

export function createHttpCuratorInvoker(
  deps: HttpCuratorInvokerDeps = {},
): CuratorInvoker {
  const baseUrl = deps.baseUrl ?? DEFAULT_BASE_URL
  const model = deps.model ?? DEFAULT_MODEL
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch
  const timeoutMs = deps.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS

  return {
    async invoke(input) {
      const payload = {
        model,
        temperature: 0.1,
        messages: [
          { role: "system", content: MNEMOSYNE_CURATOR_PROMPT },
          { role: "user", content: JSON.stringify(input) },
        ],
      }

      const response = await fetchImpl(baseUrl, {
        method: "POST",
        headers: buildHeaders(deps.authToken),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      })

      const body = await response.text()
      if (!response.ok) {
        deps.log?.("[curator-invoker] adapter returned non-ok", {
          status: response.status,
          body,
        })
        throw new CuratorInvokerError(
          `curator adapter returned ${response.status}`,
          body,
        )
      }

      const content = extractContentFromOpenAiResponse(body)
      if (!content) {
        throw new CuratorInvokerError(
          "curator adapter response had no assistant message content",
          body,
        )
      }

      return parseCuratorResponse(content)
    },
  }
}

function buildHeaders(authToken: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  }
  if (authToken) headers.authorization = `Bearer ${authToken}`
  return headers
}

function extractContentFromOpenAiResponse(body: string): string | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return undefined
  }
  if (typeof parsed !== "object" || parsed === null) return undefined
  const maybeChoices = (parsed as { choices?: unknown }).choices
  if (!Array.isArray(maybeChoices) || maybeChoices.length === 0) return undefined
  const firstChoice = maybeChoices[0]
  if (typeof firstChoice !== "object" || firstChoice === null) return undefined
  const message = (firstChoice as { message?: unknown }).message
  if (typeof message !== "object" || message === null) return undefined
  const content = (message as { content?: unknown }).content
  return typeof content === "string" ? content : undefined
}
