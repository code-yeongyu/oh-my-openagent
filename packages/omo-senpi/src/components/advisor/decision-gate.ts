// The gate asks ONE typed question of a `/v1/decisions` endpoint (the request shape TypeSafe Jev
// and the gateways that front it accept: `state` plus a `questions` map) and reads back a
// probability. Every failure resolves to a typed outcome; the caller never sees a throw.

export const WANDERING_QUESTION_ID = "wandering"

export const WANDERING_INSTRUCTIONS =
  "Is this coding agent stuck or wandering: repeating the same failing action, looping over the same files or commands, or drifting away from the task without making progress?"

export type DecisionGateOutcome =
  | { readonly kind: "scored"; readonly probability: number; readonly inputTokens?: number }
  | { readonly kind: "no_key" }
  | { readonly kind: "failed"; readonly reason: string }

export interface DecisionGateRequest {
  readonly url: string
  readonly model: string
  readonly apiKey: string | undefined
  readonly state: string
  readonly timeoutMs: number
  readonly fetch?: typeof fetch
}

export async function askWanderingGate(request: DecisionGateRequest): Promise<DecisionGateOutcome> {
  if (request.apiKey === undefined || request.apiKey.length === 0) return { kind: "no_key" }
  const fetchImpl = request.fetch ?? fetch
  let response: Response
  try {
    response = await fetchImpl(request.url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${request.apiKey}` },
      body: JSON.stringify({
        model: request.model,
        state: request.state,
        questions: { [WANDERING_QUESTION_ID]: { type: "noul", instructions: WANDERING_INSTRUCTIONS } },
      }),
      signal: AbortSignal.timeout(request.timeoutMs),
    })
  } catch (error) {
    return { kind: "failed", reason: error instanceof Error ? error.name : "fetch_failed" }
  }
  if (!response.ok) return { kind: "failed", reason: `http_${response.status}` }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    return { kind: "failed", reason: "invalid_json" }
  }
  return parseWanderingAnswer(body)
}

export function parseWanderingAnswer(body: unknown): DecisionGateOutcome {
  if (!isRecord(body) || !isRecord(body["answers"])) return { kind: "failed", reason: "no_answers" }
  const answer = body["answers"][WANDERING_QUESTION_ID]
  if (!isRecord(answer)) return { kind: "failed", reason: "no_answer" }
  const probability = answer["noul"]
  if (typeof probability !== "number" || !Number.isFinite(probability) || probability < 0 || probability > 1) {
    return { kind: "failed", reason: "invalid_noul" }
  }
  const usage = body["usage"]
  const inputTokens = isRecord(usage) && typeof usage["input_tokens"] === "number" ? usage["input_tokens"] : undefined
  return inputTokens === undefined ? { kind: "scored", probability } : { kind: "scored", probability, inputTokens }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
