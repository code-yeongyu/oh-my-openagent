import { randomBytes } from "node:crypto"
import { arch, platform, release } from "node:os"
import { join } from "node:path"
import { createOtlpTelemetryTransport } from "@oh-my-opencode/telemetry-core/otlp"
import type { TelemetryCaptureMessage, TelemetryTransport } from "@oh-my-opencode/telemetry-core"
import { resolveAgentHome } from "../agent-home/resolve-agent-home"
import { isOtlpEvent, OTLP_SPANS, projectOtlpEvent } from "./otlp-projection"
import type { TransportInput } from "./otlp"

/** No key means no collector sender, spool or network activity; PostHog is independent. */
export async function createSenpiOtlpTransport(
  input: TransportInput & { readonly ingestKey: string },
  message: TelemetryCaptureMessage,
): Promise<TelemetryTransport | null> {
  const { ingestKey } = input
  if (ingestKey.length === 0 || !isOtlpEvent(message.event)) return null
  const properties = message.properties ?? {}
  const version = typeof properties["package_version"] === "string" ? properties["package_version"] : "0.0.0"
  const os = platform()
  const machineArch = arch()
  const spoolRoot = resolveAgentHome({ env: input.env })
  const transport = await createOtlpTelemetryTransport({
    productEnvPrefix: "OMO_SENPI",
    ingestKey,
    spoolRoot,
    spoolDir: join(spoolRoot, "omo-senpi", "otlp"),
    env: input.env,
    consent: input.consent,
    diagnostics: input.diagnostics,
    source: input.source,
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
    capture(value) {
      if (isOtlpEvent(value.event)) transport.capture(value)
    },
  }
}
