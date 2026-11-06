import { randomBytes } from "node:crypto"
import { arch, platform, release } from "node:os"
import { join } from "node:path"
import { createOtlpTelemetryTransport, isOtlpTelemetryEnabled } from "@oh-my-opencode/telemetry-core/otlp"
import type { TelemetryCaptureMessage, TelemetryTransport } from "@oh-my-opencode/telemetry-core"
import { resolveAgentHome } from "../agent-home/resolve-agent-home"
import { isOtlpEvent, OTLP_SPANS, projectOtlpEvent } from "./otlp-projection"
import type { TransportInput } from "./otlp"
import { invalidateInstallIngestKey, resolveInstallIngestKey } from "./ingest-key"

/** Registration and the sender are both behind the same consent gate; PostHog is independent. */
export async function createSenpiOtlpTransport(
  input: TransportInput,
  message: TelemetryCaptureMessage,
): Promise<TelemetryTransport | null> {
  const allowed = (): boolean => {
    try { return isOtlpTelemetryEnabled({ env: input.env, productEnvPrefix: "OMO_SENPI" }) && input.consent() }
    catch { return false }
  }
  if (!isOtlpEvent(message.event) || !allowed()) return null
  const spoolRoot = resolveAgentHome({ env: input.env })
  const explicitKey = input.env["OMO_TELEMETRY_INGEST_KEY"]?.trim()
  // An explicitly empty key is an off switch, as in the desktop sender.
  if (explicitKey === "") return null
  const ingestKey = explicitKey || await resolveInstallIngestKey({
    root: spoolRoot, env: input.env, hash: message.distinctId, consent: allowed,
  })
  if (!ingestKey || !allowed()) return null
  const properties = message.properties ?? {}
  const version = typeof properties["package_version"] === "string" ? properties["package_version"] : "0.0.0"
  const os = platform()
  const machineArch = arch()
  let rejected = false
  let stopping: Promise<void> | undefined
  const transport = await createOtlpTelemetryTransport({
    productEnvPrefix: "OMO_SENPI",
    ingestKey,
    spoolRoot,
    spoolDir: join(spoolRoot, "omo-senpi", "otlp"),
    env: input.env,
    consent: input.consent,
    diagnostics: input.diagnostics,
    source: input.source,
    ...(explicitKey ? {} : (() => {
      // Keep in-flight batches local while the core transport's shutdown settles.
      return {
        fetch: async (url: string, init: RequestInit) => {
          if (rejected) return new Response(null, { status: 401 })
          const response = await fetch(url, init)
          if (response.status === 401) {
            rejected = true
            invalidateInstallIngestKey(spoolRoot, ingestKey)
            // Do not await: shutdown's final flush is waiting for this response.
            stopping = transport?.shutdown()
          }
          return response
        },
      }
    })()),
    project: projectOtlpEvent,
    spans: OTLP_SPANS,
    resource: {
      "service.name": "omo-senpi",
      "service.version": version,
      "service.instance.id": randomBytes(16).toString("hex"),
      "omo.install.hash": message.distinctId,
      "omo.schema.version": 4,
      "omo.surface": properties["surface"] === "desktop" ? "desktop" : "cli",
      "omo.ci": properties["ci"] === true,
      "os.type": os === "win32" ? "windows" : os,
      "os.version": release().match(/^\d+(?:\.\d+){1,3}/u)?.[0] ?? "0.0",
      "host.arch": ({ x64: "amd64", arm64: "arm64", ia32: "x86", arm: "arm32" } as Readonly<Record<string, string>>)[machineArch] ?? "other",
      "telemetry.sdk.name": "omo-otel-minimal",
      "telemetry.sdk.language": "nodejs",
      "telemetry.sdk.version": "1.0.0",
    },
    scope: { name: "omo-senpi", version },
    shutdownTimeoutMs: 500,
  })
  if (transport === null) return null
  return {
    ...transport,
    async flush() {
      await (stopping ?? transport.flush())
      await stopping
    },
    shutdown: () => stopping ?? transport.shutdown(),
    capture(value) {
      if (!rejected && isOtlpEvent(value.event)) transport.capture(value)
    },
  }
}
