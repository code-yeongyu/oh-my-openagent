import { randomUUID } from "node:crypto"
import { arch, platform, release } from "node:os"

import type { TelemetryEnv } from "@oh-my-opencode/telemetry-core"

import { VERSION_PATTERN } from "./event-schema-constraints"
import { getOmoNativeAttribution, OMO_NATIVE_SCHEMA_VERSION } from "./product-identity"
import { SEMCONV_MAP } from "./semconv-map"

/**
 * The OTLP Resource of this process (plan D-P): the attributes the collector denormalizes into every
 * stored row. `service.instance.id` is minted once per process (a UUIDv4 without dashes), so two
 * processes of one install share `omo.install.hash` and never share an instance id. Identity-none
 * products (omo-cloud) never read or create the install-id file.
 */

const PROCESS_INSTANCE_ID = randomUUID().replaceAll("-", "")

export type OmoNativeResourceProduct = "omo-senpi" | "omo-cloud"

export type OmoNativeResourceInput = {
  readonly product?: OmoNativeResourceProduct
  /** The SDK that will export the records (`opentelemetry` or the in-house fallback) and its version. */
  readonly sdk: { readonly name: string; readonly version: string }
  readonly packageVersion: string
  readonly env?: TelemetryEnv
  readonly stateDir?: string
  readonly now?: Date
  readonly os?: { readonly platform: () => string; readonly release: () => string; readonly arch: () => string }
}

export type OmoNativeResource = Readonly<Record<string, string | number | boolean>>

function wire(table: string, id: string, fallback: string | undefined): string | undefined {
  return SEMCONV_MAP.values[table]?.rows.find((row) => row.id === id)?.wire ?? fallback
}

/** Kernel release shapes the artifact accepts; anything else is omitted (the attribute is optional). */
const OS_VERSION = /^[0-9]+(\.[0-9]+){1,3}(-[0-9A-Za-z.-]{1,32})?$/
const VERSION = new RegExp(VERSION_PATTERN)

/** A version outside VERSION_PATTERN (a dev build, a build-metadata suffix) is omitted, never sent. */
function versionOrOmitted(key: string, value: string): Record<string, string> {
  return VERSION.test(value) ? { [key]: value } : {}
}

export function createOmoNativeResource(input: OmoNativeResourceInput): OmoNativeResource {
  const product = input.product ?? "omo-senpi"
  const os = input.os ?? { platform, release, arch }
  const attribution = product === "omo-cloud"
    ? undefined
    : getOmoNativeAttribution({
      ...(input.env === undefined ? {} : { env: input.env }),
      ...(input.stateDir === undefined ? {} : { stateDir: input.stateDir }),
      ...(input.now === undefined ? {} : { now: input.now }),
    })
  const ci = attribution?.ci ?? isCi((input.env ?? process.env)["CI"])
  const osType = wire("os.type", os.platform(), undefined)
  const osVersion = os.release()
  return {
    "service.name": product,
    ...versionOrOmitted("service.version", input.packageVersion),
    "service.instance.id": PROCESS_INSTANCE_ID,
    ...(attribution === undefined ? {} : { "omo.install.hash": attribution.install_hash }),
    ...(osType === undefined ? {} : { "os.type": osType }),
    ...(OS_VERSION.test(osVersion) ? { "os.version": osVersion } : {}),
    "host.arch": wire("host.arch", os.arch(), "other") ?? "other",
    "telemetry.sdk.name": input.sdk.name,
    "telemetry.sdk.language": "nodejs",
    ...versionOrOmitted("telemetry.sdk.version", input.sdk.version),
    "omo.schema.version": OMO_NATIVE_SCHEMA_VERSION,
    "omo.surface": product === "omo-cloud" ? "cloud" : attribution?.surface ?? "cli",
    "omo.ci": ci,
  }
}

function isCi(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase() ?? ""
  return normalized !== "" && normalized !== "0" && normalized !== "false"
}
