import { dirname } from "node:path"

import { createOtlpTelemetryTransport } from "./otlp-entry"
import { capture, TEST_SCOPE, testResource, testWireProjection, TEST_SPANS } from "./otlp-test-support"

const [dir, endpoint] = process.argv.slice(2)
if (dir === undefined || endpoint === undefined) throw new Error("usage: otlp-timeout-child.ts <spool dir> <endpoint>")

// Real fetch, real retry sleeps, no shutdown(): the process must still exit on its own.
const transport = await createOtlpTelemetryTransport({
  productEnvPrefix: "OMO_TEST",
  ingestKey: "test-ingest-key",
  spoolDir: dir,
  spoolRoot: dirname(dir),
  resource: testResource(),
  scope: TEST_SCOPE, project: testWireProjection, spans: TEST_SPANS,
  env: {},
  endpoint,
  requestTimeoutMs: 200,
})
if (transport === null) throw new Error("transport unexpectedly disabled")
capture(transport, "feature_used", { feature: "a" })
void transport.flush()
process.stdout.write("FLUSHING\n")
