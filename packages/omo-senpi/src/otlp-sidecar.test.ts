import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = fileURLToPath(new URL("..", import.meta.url))

for (const mode of ["no-key", "missing-chunk", "unused"] as const) {
  test(`#given ${mode} #when the default telemetry transport runs #then OTLP import stays gated and PostHog is independent`, async () => {
    // A fresh runtime prevents the suite's other imports or mocks from hiding an eager exporter.
    const probe = `
import { mock } from "bun:test"
let resolved = 0
const captured = []
const diagnostics = []
globalThis.fetch = () => { throw new Error("unexpected network access") }
mock.module("@oh-my-opencode/telemetry-core/otlp", () => {
  resolved++
  return { createOtlpTelemetryTransport() { throw new Error("synthetic missing OTLP sidecar") } }
})
mock.module("#omo-telemetry-otlp-runtime", () => {
  resolved++
  throw new Error("synthetic missing OTLP sidecar")
})
mock.module("#omo-telemetry-posthog-runtime", () => ({
  createDefaultPostHogTransport() {
    return { capture(value) { captured.push(value.event) }, async flush() {}, async shutdown() {} }
  },
}))
let error
try {
  const { createSenpiTelemetryTransportFactory, createSenpiOtlpTransport } = await import("./src/components/telemetry/otlp.ts")
  const env = {
    OMO_TELEMETRY_INGEST_KEY: ${JSON.stringify(mode === "no-key" ? "" : "synthetic-test-key")},
    OMO_CODING_AGENT_DIR: process.env.HOME, OMO_TELEMETRY_ENDPOINT: "http://127.0.0.1",
  }
  const input = { env, consent: () => true, diagnostics: value => diagnostics.push(value.event) }
  const transport = createSenpiTelemetryTransportFactory(input)("synthetic-posthog-key", {
    host: "http://127.0.0.1", disableGeoip: false, enableExceptionAutocapture: false,
    enableLocalEvaluation: false, strictLocalEvaluation: true, disableRemoteConfig: true,
    flushAt: 20, flushInterval: 0,
  })
  if (${JSON.stringify(mode)} !== "unused") {
    transport.capture({ distinctId: "synthetic", event: "daily_active", properties: {} })
    await transport.flush()
  }
  await transport.shutdown()
  if (${JSON.stringify(mode)} === "no-key") {
    const result = await createSenpiOtlpTransport(input, { distinctId: "synthetic", event: "daily_active" })
    if (result !== null) throw new Error("missing key did not disable OTLP")
  }
} catch (value) { error = String(value) }
console.log(JSON.stringify({ resolved, captured, diagnostics, error }))
`
    // The child's HOME and agent dir live in a private directory removed below: a macOS child process
    // creates ~/Library under HOME, which must never land in the shared hermetic temp root (#9766).
    const home = mkdtempSync(join(tmpdir(), "omo-otlp-sidecar-"))
    let exitCode: number
    let stdout: string
    let stderr: string
    try {
      const child = Bun.spawn([process.execPath, "--eval", probe], {
        cwd: packageRoot,
        env: { PATH: process.env.PATH, HOME: home, TMPDIR: process.env.TMPDIR, OMO_TELEMETRY_INGEST_KEY: "" },
        stdout: "pipe", stderr: "pipe", timeout: 30_000,
      })
      ;[exitCode, stdout, stderr] = await Promise.all([
        child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
      ])
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
    expect(exitCode, stderr).toBe(0)
    const result = JSON.parse(stdout)
    expect(result.error).toBeUndefined()
    expect(result.resolved).toBe(mode === "missing-chunk" ? 1 : 0)
    expect(result.captured).toEqual(mode === "unused" ? [] : ["daily_active"])
    expect(result.diagnostics).toEqual(mode === "missing-chunk" ? ["telemetry_otlp_send_failed"] : [])
  }, 45_000)
}
