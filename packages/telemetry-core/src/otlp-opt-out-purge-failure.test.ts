import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { getTelemetryDiagnosticsFilePath, writeTelemetryDiagnostic } from "./diagnostics"
import { createOtlpTelemetryTransport } from "./otlp-entry"
import { createBatchId } from "./otlp-spool-dir"
import { createSpoolRoot, spoolNames, TEST_SCOPE, testResource, testWireProjection, TEST_SPANS } from "./otlp-test-support"

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

/** chmod cannot deny the owner on Windows, and root ignores directory permissions. */
const canDenyUnlink = process.platform !== "win32" && typeof process.getuid === "function" && process.getuid() !== 0

describe("an opt-out purge that cannot delete its own spool file reports it as a failed deletion", () => {
  test.skipIf(!canDenyUnlink)(
    "#given a spool file of the current user in a spool directory that denies unlink #when the process starts opted out #then the file stays, and the diagnostics file records one telemetry_spool_purge_failed with the errno code and no path",
    async () => {
      // given
      const created = createSpoolRoot("telemetry-core-purge-failure-")
      const spoolDir = created.dir
      mkdirSync(spoolDir, { recursive: true })
      const sealed = `batch-logs-${createBatchId(Date.now())}.otlp`
      writeFileSync(join(spoolDir, sealed), "sealed")
      chmodSync(spoolDir, 0o500)
      cleanups.push(() => chmodSync(spoolDir, 0o700), created.cleanup)
      const diagnosticsDir = join(dirname(spoolDir), "diagnostics")

      // when
      const transport = await createOtlpTelemetryTransport({
        productEnvPrefix: "OMO_TEST",
        ingestKey: "k",
        spoolDir,
        spoolRoot: dirname(spoolDir),
        resource: testResource(),
        scope: TEST_SCOPE, project: testWireProjection, spans: TEST_SPANS,
        env: { DO_NOT_TRACK: "1" },
        diagnostics: (input) => writeTelemetryDiagnostic(input, { diagnosticsDir }),
        autoStart: false,
      })

      // then
      expect(transport).toBeNull()
      expect(spoolNames(spoolDir)).toEqual([sealed])
      const records = readFileSync(getTelemetryDiagnosticsFilePath(diagnosticsDir), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
      expect(records.map(({ timestamp: _, ...rest }) => rest)).toEqual([
        { event: "telemetry_spool_purge_failed", source: "otlp", error_code: "EACCES" },
      ])
      expect(JSON.stringify(records)).not.toContain(spoolDir)
    },
  )
})
