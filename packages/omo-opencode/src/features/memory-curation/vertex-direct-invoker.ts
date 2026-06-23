import { MNEMOSYNE_CURATOR_PROMPT } from "./curator-prompt"
import type { CuratorInvoker, CuratorInvokerInput } from "./invoker"
import { CuratorInvokerError } from "./invoker"
import type { CuratorResponse } from "./types"
import { parseCuratorResponse } from "./response-parser"

export interface VertexDirectCuratorInvokerDeps {
  projectId: string
  location?: string
  model?: string
  temperature?: number
  requestTimeoutMs?: number
  tokenProvider: VertexTokenProvider
  fetchImpl?: typeof fetch
  log?: (message: string, ...args: unknown[]) => void
}

export interface VertexTokenProvider {
  getAccessToken(): Promise<string>
  invalidateAndRefresh?(): Promise<string>
}

const DEFAULT_LOCATION = "global"
const DEFAULT_MODEL = "google/gemini-3.1-pro-preview"
const DEFAULT_TIMEOUT_MS = 90_000
const DEFAULT_TEMPERATURE = 0.1

export function createVertexDirectCuratorInvoker(
  deps: VertexDirectCuratorInvokerDeps,
): CuratorInvoker {
  const location = deps.location ?? DEFAULT_LOCATION
  const model = deps.model ?? DEFAULT_MODEL
  const temperature = deps.temperature ?? DEFAULT_TEMPERATURE
  const timeoutMs = deps.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch
  const url = `https://aiplatform.googleapis.com/v1/projects/${deps.projectId}/locations/${location}/endpoints/openapi/chat/completions`

  const issueRequest = async (input: CuratorInvokerInput, token: string) => {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature,
        messages: [
          { role: "system", content: MNEMOSYNE_CURATOR_PROMPT },
          { role: "user", content: JSON.stringify(input) },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const body = await response.text()
    return { status: response.status, body }
  }

  return {
    async invoke(input: CuratorInvokerInput): Promise<CuratorResponse> {
      let token = await deps.tokenProvider.getAccessToken()
      let { status, body } = await issueRequest(input, token)

      if (status === 401 && deps.tokenProvider.invalidateAndRefresh) {
        deps.log?.("[curator-invoker-vertex] 401 — refreshing token and retrying")
        token = await deps.tokenProvider.invalidateAndRefresh()
        ;({ status, body } = await issueRequest(input, token))
      }

      if (status !== 200) {
        deps.log?.("[curator-invoker-vertex] vertex returned non-ok", {
          status,
          body,
        })
        throw new CuratorInvokerError(
          `vertex direct curator invoker returned ${status}`,
          body,
        )
      }

      const content = extractContentFromOpenAiResponse(body)
      if (!content) {
        throw new CuratorInvokerError(
          "vertex direct curator invoker: no assistant message content",
          body,
        )
      }

      return parseCuratorResponse(content)
    },
  }
}

export function createGcloudTokenProvider(
  deps: {
    cacheTtlMs?: number
    log?: (message: string, ...args: unknown[]) => void
  } = {},
): VertexTokenProvider {
  const ttlMs = deps.cacheTtlMs ?? 45 * 60_000
  let cachedToken = ""
  let cachedUntil = 0

  const fetchFresh = async (): Promise<string> => {
    const token = (await Bun.$`gcloud auth print-access-token`.quiet().text()).trim()
    if (!token) {
      throw new Error(
        "Failed to acquire Vertex access token via gcloud auth print-access-token",
      )
    }
    cachedToken = token
    cachedUntil = Date.now() + ttlMs
    return token
  }

  return {
    async getAccessToken() {
      if (cachedToken && Date.now() < cachedUntil) return cachedToken
      return fetchFresh()
    },
    async invalidateAndRefresh() {
      cachedToken = ""
      cachedUntil = 0
      return fetchFresh()
    },
  }
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
