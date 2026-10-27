import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { inspectOtlpRequest } from "@oh-my-opencode/telemetry-core/otlp"
import { createSenpiOtlpTransport } from "./otlp"

const message = {
  distinctId: "a".repeat(64), event: "turn_completed",
  properties: {
    package_version: "5.1.48", install_hash: "a".repeat(64), surface: "cli", ci: false,
    $session_id: "b".repeat(64), provider: "google", model_id: "gemini-3.1-pro",
    input_tokens: 1, cache_read_tokens: 2, cache_write_tokens: 3, cost_1e4: 10,
  },
}

test("OTLP uses the runtime ingest key and base endpoint and emits pinned protobuf records", async () => {
  const root = mkdtempSync(join(tmpdir(), "omo-dual-send-"))
  const posted: { url: string; key: string | null; body: Uint8Array }[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request) {
      posted.push({
        url: request.url, key: request.headers.get("x-omo-ingest-key"),
        body: new Uint8Array(await request.arrayBuffer()),
      })
      return new Response(null, { status: 200 })
    },
  })
  try {
    const transport = await createSenpiOtlpTransport({
      env: { OMO_CODING_AGENT_DIR: root, OMO_TELEMETRY_INGEST_KEY: "runtime-test-key", OMO_TELEMETRY_ENDPOINT: server.url.origin },
      consent: () => true,
    }, message)
    expect(transport).not.toBeNull()
    transport?.capture(message)
    transport?.capture({ ...message, event: "omo_senpi_daily_active" })
    await transport?.flush?.()
    await transport?.shutdown()
    expect(posted).toHaveLength(1)
    expect(posted[0]?.key).toBe("runtime-test-key")
    expect(posted[0]?.url).toBe(`${server.url.origin}/v1/logs`)
    const first = posted[0]
    if (first === undefined) throw new Error("expected one OTLP request, none was posted")
    const records = await inspectOtlpRequest("logs", first.body)
    expect(records.logs).toHaveLength(1)
    expect(records.logs[0]).toMatchObject({
      eventName: "omo.turn_completed",
      attributes: {
        "session.id": "b".repeat(64),
        "gen_ai.usage.input_tokens": 6,
        "omo.cost.usd_1e4": 10,
        "gen_ai.provider.name": "gcp.gemini",
      },
    })
  } finally {
    await server.stop(true)
    rmSync(root, { recursive: true, force: true })
  }
})

for (const [label, env, consent] of [
  ["missing key", {}, true],
  ["config opted out", { OMO_TELEMETRY_INGEST_KEY: "test-key" }, false],
  ["DO_NOT_TRACK", { OMO_TELEMETRY_INGEST_KEY: "test-key", DO_NOT_TRACK: "1" }, true],
  ["product opted out", { OMO_TELEMETRY_INGEST_KEY: "test-key", OMO_SENPI_DISABLE_POSTHOG: "1" }, true],
  ["SDK disabled", { OMO_TELEMETRY_INGEST_KEY: "test-key", OTEL_SDK_DISABLED: "true" }, true],
] as const) {
  test(`OTLP is null with ${label}`, async () => {
    const root = mkdtempSync(join(tmpdir(), "omo-dual-send-optout-"))
    try {
      expect(await createSenpiOtlpTransport({
        env: { ...env, OMO_CODING_AGENT_DIR: root }, consent: () => consent,
      }, message)).toBeNull()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
}
