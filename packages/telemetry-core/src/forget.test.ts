import { afterEach, describe, expect, test } from "bun:test"

import { getTelemetryDistinctId, requestTelemetryForget } from "./index"

const INSTALL_ID = "a".repeat(64)
const LEGACY_ID = getTelemetryDistinctId("omo-senpi:", {
  arch: () => "arm64",
  cpus: () => [],
  hostname: () => "test-host",
  platform: () => "darwin",
  release: () => "25.3.0",
  totalmem: () => 0,
  type: () => "Darwin",
})

type Received = { readonly method: string; readonly path: string; readonly contentType: string | null; readonly body: unknown }

const servers: ReturnType<typeof Bun.serve>[] = []

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true)
})

function startCollector(response: { status: number; body: unknown } = { status: 202, body: { status: "scheduled" } }) {
  const received: Received[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      received.push({
        method: request.method,
        path: new URL(request.url).pathname,
        contentType: request.headers.get("content-type"),
        body: await request.json(),
      })
      return Response.json(response.body, { status: response.status })
    },
  })
  servers.push(server)
  return { received, endpoint: `http://127.0.0.1:${server.port}` }
}

describe("requestTelemetryForget", () => {
  test("#given a legacy PostHog distinct id #when forgetting #then the collector receives it beside the install id", async () => {
    const collector = startCollector()

    const result = await requestTelemetryForget({
      env: { OMO_TELEMETRY_ENDPOINT: collector.endpoint },
      installId: INSTALL_ID,
      legacyDistinctId: LEGACY_ID,
    })

    expect(collector.received).toEqual([
      {
        method: "POST",
        path: "/v1/forget",
        contentType: "application/json",
        body: { install_id: INSTALL_ID, legacy_distinct_id: LEGACY_ID },
      },
    ])
    expect(result).toEqual({ status: "sent", httpStatus: 202, response: { status: "scheduled" } })
  })

  test("#given no legacy distinct id #when forgetting #then the body has no legacy_distinct_id key", async () => {
    const collector = startCollector()

    await requestTelemetryForget({ env: { OMO_TELEMETRY_ENDPOINT: `${collector.endpoint}/` }, installId: INSTALL_ID })

    expect(collector.received.map((entry) => entry.body)).toEqual([{ install_id: INSTALL_ID }])
  })

  test("#given a legacy id that is not a 64-hex distinct id #when forgetting #then it is never sent", async () => {
    const collector = startCollector()

    await requestTelemetryForget({
      env: { OMO_TELEMETRY_ENDPOINT: collector.endpoint },
      installId: INSTALL_ID,
      legacyDistinctId: "my-laptop.local",
    })

    expect(collector.received.map((entry) => entry.body)).toEqual([{ install_id: INSTALL_ID }])
  })

  test("#given a missing or malformed install id #when forgetting #then nothing reaches the network", async () => {
    const collector = startCollector()

    for (const installId of ["", "A".repeat(64), "a".repeat(63), "not-an-id"]) {
      const result = await requestTelemetryForget({
        env: { OMO_TELEMETRY_ENDPOINT: collector.endpoint },
        installId,
        legacyDistinctId: LEGACY_ID,
      })
      expect(result).toEqual({ status: "skipped", reason: "invalid_install_id" })
    }
    expect(collector.received).toEqual([])
  })

  test("#given every opt-out variable #when the user explicitly forgets #then the deletion request is still delivered", async () => {
    const collector = startCollector()

    await requestTelemetryForget({
      env: {
        DO_NOT_TRACK: "1",
        OMO_DISABLE_POSTHOG: "1",
        OMO_SEND_ANONYMOUS_TELEMETRY: "0",
        OMO_TELEMETRY_ENDPOINT: collector.endpoint,
      },
      installId: INSTALL_ID,
      legacyDistinctId: LEGACY_ID,
    })

    expect(collector.received.map((entry) => entry.body)).toEqual([
      { install_id: INSTALL_ID, legacy_distinct_id: LEGACY_ID },
    ])
  })

  test("#given the collector rejects the request #when forgetting #then the failure is returned, not thrown", async () => {
    const collector = startCollector({ status: 400, body: { error: "invalid install_id" } })

    const result = await requestTelemetryForget({ env: { OMO_TELEMETRY_ENDPOINT: collector.endpoint }, installId: INSTALL_ID })

    expect(result).toEqual({ status: "failed", reason: "http", httpStatus: 400, response: { error: "invalid install_id" } })
  })

  test("#given an unreachable collector #when forgetting #then a network failure is returned", async () => {
    const collector = startCollector()
    servers.splice(0).forEach((server) => server.stop(true))

    const result = await requestTelemetryForget({ env: { OMO_TELEMETRY_ENDPOINT: collector.endpoint }, installId: INSTALL_ID })

    expect(result).toEqual({ status: "failed", reason: "network" })
  })
})
