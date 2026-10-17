import { afterEach, describe, expect, test } from "bun:test"

import { createDefaultPostHogTransport, TelemetryDeliveryError } from "./posthog-client"

// A send counts as delivered only on a 2xx answer. posthog-node swallows request failures inside
// captureImmediate, so the transport must report them itself: a resolved promise means accepted.
describe("#given the real PostHog transport against a fake HTTP server", () => {
  const servers: { stop: (force?: boolean) => unknown }[] = []
  afterEach(() => {
    for (const server of servers.splice(0)) server.stop(true)
  })

  const serve = (handler: () => Response | Promise<Response>): string => {
    const server = Bun.serve({ port: 0, fetch: handler })
    servers.push(server)
    return server.url.origin
  }

  const refusedHost = (): string => {
    const server = Bun.serve({ port: 0, fetch: () => new Response("{}") })
    const host = server.url.origin
    server.stop(true)
    return host
  }

  const send = async (host: string, extra: Record<string, unknown> = {}): Promise<unknown> => {
    const transport = createDefaultPostHogTransport("test-key", {
      host,
      disableGeoip: true,
      enableExceptionAutocapture: false,
      enableLocalEvaluation: false,
      strictLocalEvaluation: true,
      disableRemoteConfig: true,
      flushAt: 20,
      flushInterval: 10_000,
      ...extra,
    })
    try {
      await transport.captureImmediate?.({ distinctId: "machine-hash", event: "session_summary", properties: { turns: 1 }, uuid: "0b6c5d3e-2f1a-4c8b-9d7e-6a5b4c3d2e1f" })
      return "accepted"
    } catch (error) {
      return error instanceof TelemetryDeliveryError ? { permanent: error.permanent } : "other-error"
    } finally {
      await transport.shutdown()
    }
  }

  test("#when the server answers 200 #then the send resolves", async () => {
    expect(await send(serve(() => new Response("{}", { status: 200 })))).toBe("accepted")
  })

  test("#when the server answers 500 #then the send rejects as retryable", async () => {
    expect(await send(serve(() => new Response("{}", { status: 500 })))).toEqual({ permanent: false })
  })

  test("#when the server answers 429 #then the send rejects as retryable", async () => {
    expect(await send(serve(() => new Response("{}", { status: 429 })))).toEqual({ permanent: false })
  })

  test("#when the server answers 400 #then the send rejects as permanent", async () => {
    expect(await send(serve(() => new Response("{}", { status: 400 })))).toEqual({ permanent: true })
  })

  test("#when the connection is refused #then the send rejects as retryable", async () => {
    expect(await send(refusedHost())).toEqual({ permanent: false })
  })

  test("#when the server never answers #then the send rejects as retryable after the request timeout", async () => {
    const host = serve(() => new Promise<Response>(() => undefined))
    expect(await send(host, { requestTimeout: 100 })).toEqual({ permanent: false })
  })
})
