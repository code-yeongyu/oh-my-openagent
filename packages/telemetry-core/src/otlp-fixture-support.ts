import { context, ROOT_CONTEXT, trace, TraceFlags } from "@opentelemetry/api"

import { capture, makeTransport, recordingFetch } from "./otlp-test-support"

const FIXED_SPAN = { traceId: "4bf92f3577b34da6a3ce929d0e0e4736", spanId: "00f067aa0ba902b7", traceFlags: TraceFlags.SAMPLED }

/**
 * Deterministic inputs for the shared OTLP fixture: the same three events are delivered once by a
 * live send and once by a replay of the file a failed send left behind. Both request bodies must
 * be byte-identical, and the collector decodes the fixture into the rows in worker-rows.json.
 */
function emitFixtureEvents(transport: ReturnType<typeof makeTransport>): void {
  context.with(trace.setSpanContext(ROOT_CONTEXT, FIXED_SPAN), () => {
    capture(transport, "turn_completed", {
      event_id: "0190f000-0000-7000-8000-000000000001",
      $session_id: "aa".repeat(32),
      provider: "anthropic",
      turn_index: 3,
      cost_usd: 0.25,
      is_error: false,
    })
  })
  capture(transport, "feature_used", { event_id: "0190f000-0000-7000-8000-000000000002", $session_id: "aa".repeat(32), feature: "eval" })
  capture(transport, "process_crashed", { event_id: "0190f000-0000-7000-8000-000000000003", reason_code: "oom" })
}

function fixedTransport(dir: string, fetch: ReturnType<typeof recordingFetch>["fetch"]) {
  return makeTransport(dir, { fetch, bootId: "d".repeat(32), clock: () => 1_760_000_000_123_456_789n })
}

export async function produceFixtureBodies(liveDir: string, replayDir: string): Promise<{ readonly live: Uint8Array; readonly replay: Uint8Array }> {
  const live = recordingFetch()
  const liveTransport = fixedTransport(liveDir, live.fetch)
  emitFixtureEvents(liveTransport)
  await liveTransport.flush()

  const failing = fixedTransport(replayDir, recordingFetch(() => new Response(null, { status: 503 })).fetch)
  emitFixtureEvents(failing)
  await failing.flush()
  const replay = recordingFetch()
  await fixedTransport(replayDir, replay.fetch).flush()

  const liveBody = live.calls[0]?.body
  const replayBody = replay.calls[0]?.body
  if (liveBody === undefined || replayBody === undefined) throw new Error("fixture send did not happen")
  return { live: liveBody, replay: replayBody }
}
