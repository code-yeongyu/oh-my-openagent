import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  __resetTelemetryDeviceHashCacheForTesting,
  TELEMETRY_DEVICE_ID_ENV,
  getTelemetryDeviceHash,
  hashDeviceId,
  parseDarwinPlatformUuid,
  parseWindowsMachineGuid,
} from "./device-id"
import { getTelemetryIdentity } from "./identity"
import { getTelemetryInstallDistinctId } from "./install-id"

const MAC_UUID = "5a1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
const WIN_GUID = "7b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e"
const LINUX_ID = "9f86d081884c7d659a2feaa0c55ad015"
const IOREG = `+-o J316sAP  <class IOPlatformExpertDevice, id 0x100000110, registered, matched, active, busy 0 (12 ms), retain 40>
    {
      "IOPlatformUUID" = "${MAC_UUID.toUpperCase()}"
      "IOPlatformSerialNumber" = "SENTINEL-SERIAL"
    }`
const REG = `\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\r\n    MachineGuid    REG_SZ    ${WIN_GUID}\r\n\r\n`
const NO_ENV = Object.freeze({}) as Readonly<Record<string, string | undefined>>

const expectedHash = (rawId: string): string => createHash("sha256").update("omo:device:v1\u0000").update(rawId).digest("hex")

afterEach(() => {
  __resetTelemetryDeviceHashCacheForTesting()
})

describe("getTelemetryDeviceHash", () => {
  test.each([
    ["darwin", { platform: "darwin" as const, runCommand: (): string => IOREG }, MAC_UUID],
    ["win32", { platform: "win32" as const, runCommand: (): string => REG }, WIN_GUID],
    ["linux", { platform: "linux" as const, readFile: (): string => `${LINUX_ID}\n` }, LINUX_ID],
  ])("#given a %s machine id #when hashed #then only sha256(domain + normalized id) is returned", (_platform, deps, rawId) => {
    expect(getTelemetryDeviceHash({ ...deps, env: NO_ENV })).toBe(expectedHash(rawId))
    expect(getTelemetryDeviceHash({ ...deps, env: NO_ENV })).not.toContain(rawId.slice(0, 8))
  })

  test("#given darwin #when the id is read #then ioreg is asked for the platform expert device only", () => {
    const calls: string[][] = []
    getTelemetryDeviceHash({ platform: "darwin", env: NO_ENV, runCommand: (command, args) => { calls.push([command, ...args]); return IOREG } })
    expect(calls).toEqual([["/usr/sbin/ioreg", "-rd1", "-c", "IOPlatformExpertDevice"]])
  })

  test("#given linux without /etc/machine-id #when the dbus copy exists #then it is used", () => {
    const readFile = (path: string): string => {
      if (path === "/var/lib/dbus/machine-id") return LINUX_ID
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
    }
    expect(getTelemetryDeviceHash({ platform: "linux", env: NO_ENV, readFile })).toBe(expectedHash(LINUX_ID))
  })

  test.each([
    ["an all-zero uuid", { platform: "darwin" as const, runCommand: (): string => IOREG.replace(MAC_UUID.toUpperCase(), "00000000-0000-0000-0000-000000000000") }],
    ["a malformed uuid", { platform: "darwin" as const, runCommand: (): string => IOREG.replace(MAC_UUID.toUpperCase(), "not-a-uuid") }],
    ["a failing command", { platform: "win32" as const, runCommand: (): string => { throw new Error("spawn reg ENOENT") } }],
    ["a linux image with no machine-id file", { platform: "linux" as const, readFile: (): string => { throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }) } }],
    ["a short linux id", { platform: "linux" as const, readFile: (): string => "abc123\n" }],
    ["an unsupported platform", { platform: "freebsd" as const, readFile: (): string => LINUX_ID, runCommand: (): string => IOREG }],
  ])("#given %s #when hashed #then there is no device identity", (_case, deps) => {
    expect(getTelemetryDeviceHash({ ...deps, env: NO_ENV })).toBeUndefined()
  })

  test("#given OMO_TELEMETRY_DEVICE_ID=off #when a readable machine id exists #then no device identity is produced", () => {
    expect(getTelemetryDeviceHash({ platform: "darwin", runCommand: () => IOREG, env: { [TELEMETRY_DEVICE_ID_ENV]: "off" } })).toBeUndefined()
  })

  test("#given a hex OMO_TELEMETRY_DEVICE_ID #when hashed #then the override replaces the OS read", () => {
    let ran = false
    const hash = getTelemetryDeviceHash({ platform: "darwin", runCommand: () => { ran = true; return IOREG }, env: { [TELEMETRY_DEVICE_ID_ENV]: WIN_GUID.toUpperCase() } })
    expect(hash).toBe(expectedHash(WIN_GUID))
    expect(ran).toBe(false)
  })

  test("#given a malformed OMO_TELEMETRY_DEVICE_ID #when hashed #then it is ignored and the OS id is used", () => {
    expect(getTelemetryDeviceHash({ platform: "darwin", runCommand: () => IOREG, env: { [TELEMETRY_DEVICE_ID_ENV]: "my-laptop" } })).toBe(expectedHash(MAC_UUID))
  })

  test("#given the default deps #when read twice #then the OS is consulted once per process", () => {
    const first = getTelemetryDeviceHash({ env: NO_ENV })
    const second = getTelemetryDeviceHash({ env: NO_ENV })
    expect(second).toBe(first)
    if (first !== undefined) expect(first).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe("parsers", () => {
  test("ioreg output yields the lowercase uuid and nothing else from the block", () => {
    expect(parseDarwinPlatformUuid(IOREG)).toBe(MAC_UUID)
    expect(parseDarwinPlatformUuid("")).toBeUndefined()
  })

  test("reg query output yields the lowercase guid", () => {
    expect(parseWindowsMachineGuid(REG)).toBe(WIN_GUID)
    expect(parseWindowsMachineGuid("ERROR: The system was unable to find the specified registry key or value.")).toBeUndefined()
  })

  test("hashDeviceId is domain separated from a bare sha256 of the id", () => {
    expect(hashDeviceId(MAC_UUID)).toBe(expectedHash(MAC_UUID))
    expect(hashDeviceId(MAC_UUID)).not.toBe(createHash("sha256").update(MAC_UUID).digest("hex"))
  })
})

describe("getTelemetryIdentity", () => {
  const withStateDir = (run: (stateDir: string) => void): void => {
    const root = mkdtempSync(join(tmpdir(), "telemetry-identity-"))
    try {
      run(join(root, "state"))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }

  test("#given a readable device id #when resolved #then distinct id is the device hash and the install hash rides along", () => {
    withStateDir((stateDir) => {
      const identity = getTelemetryIdentity(stateDir, { env: NO_ENV, deviceId: { platform: "darwin", runCommand: () => IOREG } })
      expect(identity).toEqual({ distinctId: expectedHash(MAC_UUID), installHash: getTelemetryInstallDistinctId(stateDir), idScheme: "device" })
      expect(readdirSync(stateDir)).toEqual(["install-id"])
    })
  })

  test("#given no device id #when resolved #then the install hash is the distinct id", () => {
    withStateDir((stateDir) => {
      const identity = getTelemetryIdentity(stateDir, { env: NO_ENV, deviceId: { platform: "linux", readFile: () => { throw new Error("ENOENT") } } })
      expect(identity.idScheme).toBe("install")
      expect(identity.distinctId).toBe(identity.installHash)
      expect(identity.installHash).toBe(getTelemetryInstallDistinctId(stateDir))
    })
  })
})
