import { MODEL_OWNED_BY, SUPPORTED_MODELS } from "../defaults"
import type { ModelsResponse } from "../schemas"

export type ModelsRouteContext = {
  startedAt: number
}

export function handleModels(ctx: ModelsRouteContext): Response {
  const createdSeconds = Math.floor(ctx.startedAt / 1_000)
  const body: ModelsResponse = {
    object: "list",
    data: SUPPORTED_MODELS.map((id) => ({
      id,
      object: "model",
      created: createdSeconds,
      owned_by: MODEL_OWNED_BY,
    })),
  }
  return Response.json(body, {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}
