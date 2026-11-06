import { createTelemetryProviders } from "./otel-providers"
import { createBatchId } from "./otlp-spool-dir"
import { TEST_SCOPE, TEST_SPANS, testResource, testWireProjection } from "./otlp-test-support"

export type SpoolProducer = {
  readonly capture: (event: string, properties: Record<string, unknown>) => void
  readonly seal: (batchId: string) => string | null
  readonly close: () => void
}

/**
 * Writes spool files the way a sender process does (same resource, scope, projection and record uid),
 * without a transport: tests seal its active file under a chosen batch id, or close it unsealed to
 * leave what a process that died mid-write leaves behind.
 */
export function spoolProducer(dir: string, owner: { readonly pid: number; readonly bootId: string }): SpoolProducer {
  const providers = createTelemetryProviders({
    resource: testResource(),
    scope: TEST_SCOPE,
    spoolDir: dir,
    spans: TEST_SPANS,
    pid: owner.pid,
    bootId: owner.bootId,
  })
  return {
    capture: (event, properties) => {
      const eventId = properties["event_id"]
      providers.logger.emit({
        eventName: `omo.${event}`,
        attributes: {
          ...testWireProjection(event, properties),
          "log.record.uid": typeof eventId === "string" && eventId.length > 0 ? eventId : createBatchId(Date.now()),
        },
      })
    },
    seal: (batchId) => providers.logWriter.seal(batchId),
    close: () => providers.logWriter.close(),
  }
}
