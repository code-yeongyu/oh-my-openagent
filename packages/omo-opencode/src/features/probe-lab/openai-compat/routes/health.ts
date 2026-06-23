export type HealthRouteContext = {
  startedAt: number
  version: string
}

export type HealthBody = {
  ok: true
  uptime_ms: number
  version: string
}

export function handleHealth(ctx: HealthRouteContext): Response {
  const body: HealthBody = {
    ok: true,
    uptime_ms: Date.now() - ctx.startedAt,
    version: ctx.version,
  }
  return Response.json(body, {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}
