import { CARTOGRAPHER_PROMPT } from "./cartographer-prompt"
import type { VertexTokenProvider } from "../memory-curation/vertex-direct-invoker"
import type { CartographerInput, CartographerResponse } from "./types"

export interface CartographerInvoker {
  invoke(input: CartographerInput): Promise<CartographerResponse>
}

export interface HttpCartographerInvokerDeps {
  projectId: string
  location?: string
  model?: string
  temperature?: number
  requestTimeoutMs?: number
  tokenProvider: VertexTokenProvider
  fetchImpl?: typeof fetch
  log?: (message: string, ...args: unknown[]) => void
}

const DEFAULT_LOCATION = "global"
const DEFAULT_MODEL = "google/gemini-3.1-pro-preview"
const DEFAULT_TIMEOUT_MS = 90_000
const DEFAULT_TEMPERATURE = 0.2

export class CartographerInvokerError extends Error {
  constructor(message: string, public readonly raw?: string) {
    super(message)
    this.name = "CartographerInvokerError"
  }
}

export function createCartographerInvoker(
  deps: HttpCartographerInvokerDeps,
): CartographerInvoker {
  const location = deps.location ?? DEFAULT_LOCATION
  const model = deps.model ?? DEFAULT_MODEL
  const temperature = deps.temperature ?? DEFAULT_TEMPERATURE
  const timeoutMs = deps.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch
  const url = `https://aiplatform.googleapis.com/v1/projects/${deps.projectId}/locations/${location}/endpoints/openapi/chat/completions`

  const issueRequest = async (input: CartographerInput, token: string) => {
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
          { role: "system", content: CARTOGRAPHER_PROMPT },
          { role: "user", content: JSON.stringify(input) },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const body = await response.text()
    return { status: response.status, body }
  }

  return {
    async invoke(input: CartographerInput): Promise<CartographerResponse> {
      let token = await deps.tokenProvider.getAccessToken()
      let { status, body } = await issueRequest(input, token)

      if (status === 401 && deps.tokenProvider.invalidateAndRefresh) {
        deps.log?.("[cartographer-invoker] 401 — refreshing token and retrying")
        token = await deps.tokenProvider.invalidateAndRefresh()
        ;({ status, body } = await issueRequest(input, token))
      }

      if (status !== 200) {
        deps.log?.("[cartographer-invoker] vertex returned non-ok", { status, body })
        throw new CartographerInvokerError(
          `cartographer invoker returned ${status}`,
          body,
        )
      }

      const content = extractAssistantContent(body)
      if (!content) {
        throw new CartographerInvokerError(
          "cartographer invoker: no assistant message content",
          body,
        )
      }

      return parseCartographerResponse(content)
    },
  }
}

function extractAssistantContent(body: string): string | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return undefined
  }
  if (typeof parsed !== "object" || parsed === null) return undefined
  const choices = (parsed as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) return undefined
  const first = choices[0]
  if (typeof first !== "object" || first === null) return undefined
  const message = (first as { message?: unknown }).message
  if (typeof message !== "object" || message === null) return undefined
  const content = (message as { content?: unknown }).content
  return typeof content === "string" ? content : undefined
}

const JSON_BLOCK = /```json\s*([\s\S]*?)\s*```/

function parseCartographerResponse(raw: string): CartographerResponse {
  const fenced = JSON_BLOCK.exec(raw)
  const jsonText = fenced?.[1]?.trim() ?? raw.trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch (err) {
    throw new CartographerInvokerError(
      `cartographer response was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      raw,
    )
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new CartographerInvokerError("cartographer response root is not an object", raw)
  }
  const root = parsed as Record<string, unknown>
  return {
    draft: validateDraft(root.draft),
    rationale: typeof root.rationale === "string" ? root.rationale : "",
    confidence: clamp01(root.confidence),
    warnings: Array.isArray(root.warnings)
      ? root.warnings.filter((w): w is string => typeof w === "string")
      : [],
  }
}

function validateDraft(raw: unknown): CartographerResponse["draft"] {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== "object") return null
  const d = raw as Record<string, unknown>
  const title = typeof d.title === "string" ? d.title : undefined
  const summary = typeof d.summary === "string" ? d.summary : undefined
  const body = typeof d.body_markdown === "string" ? d.body_markdown : undefined
  const principio = typeof d.principio_guida === "string" ? d.principio_guida : undefined
  const moc = typeof d.moc === "string" ? d.moc : undefined
  if (!title || !summary || !body || !principio || !moc) return null
  const tagsRaw = Array.isArray(d.tags) ? d.tags : []
  const tags = tagsRaw.filter((t): t is string => typeof t === "string")
  const relatedRaw = Array.isArray(d.related) ? d.related : []
  const related = relatedRaw.filter((r): r is string => typeof r === "string")
  const status = normalizeStatus(d.status)
  return {
    title,
    summary,
    principio_guida: principio,
    body_markdown: body,
    tags,
    moc,
    status,
    related,
  }
}

function normalizeStatus(raw: unknown): "seed" | "budding" | "evergreen" | "archived" {
  if (raw === "budding" || raw === "evergreen" || raw === "archived") return raw
  return "seed"
}

function clamp01(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0.5
  return Math.max(0, Math.min(1, raw))
}
