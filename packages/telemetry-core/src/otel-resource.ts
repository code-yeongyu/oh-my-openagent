import type { ResourceAttributes } from "./otlp-encode"
import { OTEL_SDK_LANGUAGE, OTEL_SDK_NAME, OTEL_SDK_VERSION } from "./otel-time"

export type TelemetryResourceAttribution = {
  readonly serviceName: string
  readonly serviceVersion: string
  readonly instanceId: string
  readonly installHash?: string
  readonly platform: string
  readonly osVersion?: string
  readonly arch: string
  readonly schemaVersion: number
  readonly surface: string
  readonly ci: boolean
}

const OS_TYPES: Readonly<Record<string, string>> = { darwin: "darwin", linux: "linux", win32: "windows" }
const HOST_ARCHES: Readonly<Record<string, string>> = { x64: "amd64", arm64: "arm64", ia32: "x86", arm: "arm32" }

export function otelOsType(platform: string): string | undefined {
  return OS_TYPES[platform]
}

export function otelHostArch(arch: string): string {
  return HOST_ARCHES[arch] ?? "other"
}

export function createTelemetryResource(attribution: TelemetryResourceAttribution): ResourceAttributes {
  const osType = otelOsType(attribution.platform)
  return {
    "service.name": attribution.serviceName,
    "service.version": attribution.serviceVersion,
    "service.instance.id": attribution.instanceId,
    ...(attribution.installHash === undefined ? {} : { "omo.install.hash": attribution.installHash }),
    ...(osType === undefined ? {} : { "os.type": osType }),
    ...(attribution.osVersion === undefined ? {} : { "os.version": attribution.osVersion }),
    "host.arch": otelHostArch(attribution.arch),
    "telemetry.sdk.name": OTEL_SDK_NAME,
    "telemetry.sdk.language": OTEL_SDK_LANGUAGE,
    "telemetry.sdk.version": OTEL_SDK_VERSION,
    "omo.schema.version": attribution.schemaVersion,
    "omo.surface": attribution.surface,
    "omo.ci": attribution.ci,
  }
}
