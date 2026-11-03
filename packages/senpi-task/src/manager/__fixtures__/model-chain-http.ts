import type { Step } from "./model-chain-answers"

export const ENGINE_MODELS: Readonly<Record<string, readonly string[]>> = {
  deepseek: ["deepseek-flash"],
  zai: ["glm-5.3"],
  moonshotai: ["kimi-k3"],
  venice: ["claude-opus-5-5", "claude-opus-5"],
  anthropic: ["claude-opus-5"],
}

export type HttpProviders = {
  readonly calls: readonly string[]
  readonly modelsJson: string
  stop(): Promise<void>
}

const ERRORS = {
  quota: { status: 403, message: "You've reached your usage limit for this billing cycle. Your limit resets 3:20am.", type: "access_terminated_error" },
  refusal: { status: 400, message: "This request was flagged as a possible cybersecurity risk and refused under the content policy.", type: "invalid_request_error" },
  auth: { status: 401, message: "Unauthorized - invalid api key", type: "authentication_error" },
} as const

/**
 * The engine world's providers behind one local server: builtin providers whose base URL and key the user's
 * `models.json` points here, so a separate engine knows every model
 * from its first moment, exactly as it knows a real provider. Each request is answered from the
 * model's script and recorded. Anthropic requests are recorded and refused: no script ever needs one.
 */
export function startHttpProviders(scripts: Readonly<Record<string, readonly Step[]>>): HttpProviders {
  const remaining = new Map(Object.entries(scripts).map(([model, steps]) => [model, [...steps]]))
  const calls: string[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const provider = new URL(request.url).pathname.split("/")[1] ?? ""
      const body: unknown = await request.json()
      const model = typeof body === "object" && body !== null && "model" in body && typeof body.model === "string" ? body.model : ""
      const key = `${provider}/${model}`
      calls.push(key)
      if (provider === "anthropic") return Response.json({ type: "error", error: { type: "api_error", message: "unscripted" } }, { status: 500 })
      return respond(key, remaining.get(key)?.shift() ?? "complete")
    },
  })
  const base = `http://127.0.0.1:${server.port}`
  const providers = Object.fromEntries(Object.keys(ENGINE_MODELS).map((provider) => [
    provider,
    { baseUrl: provider === "anthropic" ? `${base}/anthropic` : `${base}/${provider}/v1`, apiKey: "test-key" },
  ]))
  return {
    calls,
    modelsJson: JSON.stringify({ providers }, null, 2),
    stop: () => server.stop(true),
  }
}

function respond(model: string, step: Step): Response {
  if (typeof step !== "string") throw new Error(`${model}: an engine world scripts no tool steps`)
  if (step !== "complete") {
    const { status, message, type } = ERRORS[step]
    return Response.json({ error: { message, type } }, { status })
  }
  const chunk = (delta: object, finish: string | null) =>
    `data: ${JSON.stringify({ id: "chain", object: "chat.completion.chunk", created: 1, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
  const usage = `data: ${JSON.stringify({ id: "chain", object: "chat.completion.chunk", created: 1, model, choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`
  return new Response(`${chunk({ content: `${model} completed` }, null)}${chunk({}, "stop")}${usage}data: [DONE]\n\n`, {
    headers: { "content-type": "text/event-stream" },
  })
}
