import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"

import type { TelemetryEnv } from "./types"

/**
 * The device half of a daily-active ping's identity (#12151).
 *
 * The OS writes one random identifier per installation of itself: `IOPlatformUUID` on macOS, `/etc/machine-id` on
 * Linux, `MachineGuid` on Windows. None of them is derived from a person, a hostname, a user name or a path, so a
 * hash of one cannot be confirmed by guessing (the #11571 defect), while it stays the same across OmO updates,
 * reinstalls and agent-dir overrides. Only `sha256(domain + id)` leaves the process; the raw id is read on the send
 * path, after every consent check, and never written anywhere.
 */

export const TELEMETRY_DEVICE_ID_ENV = "OMO_TELEMETRY_DEVICE_ID"

/** Domain separation: the same machine id hashed by another product or purpose yields an unrelated value. */
const DEVICE_HASH_DOMAIN = "omo:device:v1\u0000"
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const HEX32_PATTERN = /^[0-9a-f]{32}$/
const HEX64_PATTERN = /^[0-9a-f]{64}$/
const DISABLE_VALUES = new Set(["0", "false", "no", "none", "off"])
const COMMAND_TIMEOUT_MS = 2_000

export type TelemetryDeviceIdDeps = {
  readonly env?: TelemetryEnv
  readonly platform?: NodeJS.Platform
  readonly readFile?: (path: string) => string
  readonly runCommand?: (command: string, args: readonly string[]) => string
}

const defaultReadFile = (path: string): string => readFileSync(path, "utf8")

const defaultRunCommand = (command: string, args: readonly string[]): string =>
  execFileSync(command, [...args], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
    timeout: COMMAND_TIMEOUT_MS,
    windowsHide: true,
  })

function normalizeDeviceId(value: string, pattern: RegExp): string | undefined {
  const normalized = value.trim().toLowerCase()
  if (!pattern.test(normalized)) return undefined
  // An all-zero id is a cloned or unprovisioned image, not a device.
  return /^0+$/.test(normalized.replaceAll("-", "")) ? undefined : normalized
}

/** @internal */
export function parseDarwinPlatformUuid(ioregOutput: string): string | undefined {
  const match = /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(ioregOutput)
  return match === null ? undefined : normalizeDeviceId(match[1] ?? "", UUID_PATTERN)
}

/** @internal */
export function parseWindowsMachineGuid(regOutput: string): string | undefined {
  const match = /^\s*MachineGuid\s+REG_\w+\s+(\S+)\s*$/im.exec(regOutput)
  return match === null ? undefined : normalizeDeviceId(match[1] ?? "", UUID_PATTERN)
}

function readRawDeviceId(deps: TelemetryDeviceIdDeps): string | undefined {
  const platform = deps.platform ?? process.platform
  const readFile = deps.readFile ?? defaultReadFile
  const runCommand = deps.runCommand ?? defaultRunCommand
  try {
    if (platform === "linux") {
      for (const file of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
        try {
          const value = normalizeDeviceId(readFile(file), HEX32_PATTERN)
          if (value !== undefined) return value
        } catch {
          // Missing on minimal images; the next candidate or the install id covers it.
        }
      }
      return undefined
    }
    if (platform === "darwin") return parseDarwinPlatformUuid(runCommand("/usr/sbin/ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"]))
    if (platform === "win32") {
      return parseWindowsMachineGuid(runCommand("reg", ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"]))
    }
    return undefined
  } catch {
    // A failed or slow command never blocks a send; the caller falls back to the install id.
    return undefined
  }
}

function readEnvOverride(env: TelemetryEnv): { readonly kind: "unset" } | { readonly kind: "off" } | { readonly kind: "id"; readonly value: string } {
  const raw = env[TELEMETRY_DEVICE_ID_ENV]?.trim().toLowerCase() ?? ""
  if (raw === "") return { kind: "unset" }
  if (DISABLE_VALUES.has(raw)) return { kind: "off" }
  const value = normalizeDeviceId(raw, UUID_PATTERN) ?? normalizeDeviceId(raw, HEX32_PATTERN) ?? normalizeDeviceId(raw, HEX64_PATTERN)
  // A malformed override is ignored rather than honored: identity never follows an arbitrary string.
  return value === undefined ? { kind: "unset" } : { kind: "id", value }
}

export function hashDeviceId(rawId: string): string {
  return createHash("sha256").update(DEVICE_HASH_DOMAIN).update(rawId).digest("hex")
}

let cachedDefault: { readonly value: string | undefined } | undefined

/**
 * `sha256(domain + OS machine id)`, or undefined when the platform exposes no usable id (minimal containers,
 * unsupported platforms, a failed command). `OMO_TELEMETRY_DEVICE_ID` overrides the OS read: a hex id pins a
 * hosted or remote runtime to the device of the host that launched it, `off` disables device identity. The OS
 * read is done once per process.
 */
export function getTelemetryDeviceHash(deps: TelemetryDeviceIdDeps = {}): string | undefined {
  const override = readEnvOverride(deps.env ?? process.env)
  if (override.kind === "off") return undefined
  if (override.kind === "id") return hashDeviceId(override.value)
  const injected = deps.platform !== undefined || deps.readFile !== undefined || deps.runCommand !== undefined
  if (injected) {
    const raw = readRawDeviceId(deps)
    return raw === undefined ? undefined : hashDeviceId(raw)
  }
  if (cachedDefault === undefined) {
    const raw = readRawDeviceId(deps)
    cachedDefault = { value: raw === undefined ? undefined : hashDeviceId(raw) }
  }
  return cachedDefault.value
}

/** @internal test-only */
export function __resetTelemetryDeviceHashCacheForTesting(): void {
  cachedDefault = undefined
}
