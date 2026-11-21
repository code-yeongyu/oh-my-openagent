import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  ApiRefusal,
  type Credentials,
  KeychainLockedError,
  RequestFailure,
} from "@oh-my-opencode/omo-opencode/service-auth"
import { LocalApiError } from "@oh-my-opencode/device-service-core"
import { createOmoSdk, type OmoResult, type OmoSdkPorts } from "."

const ORIGIN = "https://accounts.example.test"
const ACCESS = "access-token-fixture-value"
const REFRESH = "refresh-token-fixture-value"
const SIGNING = "signing-private-key-fixture"
const SEALING = "sealing-private-key-fixture"
const SECRETS = [ACCESS, REFRESH, SIGNING, SEALING]

const credentials: Credentials = {
  accessToken: ACCESS,
  accessTokenExpiresAt: "2026-11-19T15:00:00.000Z",
  refreshToken: REFRESH,
  device: { id: "dev_this", name: "device-a" },
  signingPrivateKey: SIGNING,
  sealingPrivateKey: SEALING,
}

const devicesBody = {
  devices: [
    { id: "dev_this", name: "device-a", kind: "cli", platform: "linux", current: true, revokedAt: null },
    { id: "dev_other", name: "device-b", platform: "macos", current: false, revokedAt: null, machineBound: true },
    { id: "dev_gone", name: "device-c", current: false, revokedAt: "2026-11-01T00:00:00.000Z" },
  ],
}
const meBody = { user: { id: "usr_1", email: "owner@example.test" }, account: { id: "acct_1" }, deviceId: "dev_this" }

type Call = { readonly path: string; readonly headers: unknown }

function fakes(overrides: Partial<{ store: Credentials | null; request: (path: string) => unknown }> = {}) {
  const calls: Call[] = []
  const reads: string[] = []
  const ports: OmoSdkPorts = {
    desktopLaunch: () => false,
    credentialStore: {
      read: async () => {
        reads.push("read")
        return overrides.store === undefined ? credentials : overrides.store
      },
    },
    session: {
      accessToken: async () => ACCESS,
      request: async (path, init) => {
        calls.push({ path, headers: init.headers })
        if (overrides.request !== undefined) return overrides.request(path)
        return path === "/v1/me" ? meBody : devicesBody
      },
    },
    deviceServiceStatus: async () => ({ state: "connected", device: { id: "dev_this", name: "device-a" } }),
  }
  return { ports, calls, reads }
}

const sdkWith = (ports: OmoSdkPorts) => createOmoSdk({ env: { OMO_SERVICE_API_URL: ORIGIN }, cwd: tmpdir(), ports })

const errorOf = <T>(result: OmoResult<T>) => {
  if (result.kind !== "error") throw new Error(`expected an error, got ${JSON.stringify(result)}`)
  return result.error
}
const valueOf = <T>(result: OmoResult<T>): T => {
  if (result.kind !== "ok") throw new Error(`expected ok, got ${JSON.stringify(result)}`)
  return result.value
}

function secretKeys(value: unknown, path = "$"): string[] {
  if (typeof value === "string") return SECRETS.some((secret) => value.includes(secret)) ? [path] : []
  if (typeof value !== "object" || value === null) return []
  return Object.entries(value).flatMap(([key, child]) => [
    ...(/token|secret|privateKey/i.test(key) ? [`${path}.${key}`] : []),
    ...secretKeys(child, `${path}.${key}`),
  ])
}

const homes: string[] = []
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

describe("createOmoSdk reads", () => {
  test("#given a signed-in device #when whoami runs #then it names the device, the account email and the origin", async () => {
    const { ports } = fakes()
    expect(valueOf(await sdkWith(ports).account.whoami())).toEqual({
      api: ORIGIN,
      device: { id: "dev_this", name: "device-a" },
      email: "owner@example.test",
      accountId: "acct_1",
    })
  })

  test("#given an unreadable account body #when whoami runs #then the device is still answered without an email", async () => {
    const { ports } = fakes({ request: () => ({ unexpected: true }) })
    expect(valueOf(await sdkWith(ports).account.whoami())).toEqual({
      api: ORIGIN,
      device: { id: "dev_this", name: "device-a" },
    })
  })

  test("#given the account lists a revoked device #when devices.list runs #then only live devices return, this one current", async () => {
    const { ports } = fakes()
    expect(valueOf(await sdkWith(ports).devices.list())).toEqual([
      { id: "dev_this", name: "device-a", kind: "cli", platform: "linux", current: true },
      { id: "dev_other", name: "device-b", platform: "macos", machineBound: true, current: false },
    ])
  })

  test("#given every read #when its value is scanned by key and value #then no token, secret or private key is in it", async () => {
    const { ports } = fakes()
    const home = mkdtempSync(join(tmpdir(), "omo-sdk-home-"))
    homes.push(home)
    const sdk = createOmoSdk({ env: { OMO_SERVICE_API_URL: ORIGIN, HOME: home }, cwd: home, home, ports })
    const values = [
      await sdk.account.whoami(),
      await sdk.devices.list(),
      await sdk.deviceService.status(),
      await sdk.config.status(),
    ]
    expect(values.map((value) => value.kind)).toEqual(["ok", "ok", "ok", "ok"])
    expect(secretKeys(values)).toEqual([])
  })
})

describe("createOmoSdk refusals", () => {
  test("#given no stored sign-in #when a read runs #then it answers signed_out and makes no request", async () => {
    const { ports, calls } = fakes({ store: null })
    const error = errorOf(await sdkWith(ports).devices.list())
    expect(error.code).toBe("signed_out")
    expect(error.next_action).not.toBe("")
    expect(calls).toEqual([])
  })

  test("#given a desktop launch #when a read runs #then it answers desktop_sign_in without reading the store", async () => {
    const { ports, calls, reads } = fakes()
    const error = errorOf(await sdkWith({ ...ports, desktopLaunch: () => true }).account.whoami())
    expect(error.code).toBe("desktop_sign_in")
    expect(reads).toEqual([])
    expect(calls).toEqual([])
  })

  test("#given the service answers 401 #when a read runs #then it answers session_ended and the answer carries no secret", async () => {
    const { ports } = fakes({
      request: () => {
        throw new ApiRefusal("unauthorized", 401)
      },
    })
    const result = await sdkWith(ports).devices.list()
    expect(errorOf(result)).toMatchObject({ code: "session_ended", details: { code: "unauthorized" } })
    expect(secretKeys(result)).toEqual([])
  })

  test("#given another refusal #when a read runs #then it answers service_refused with the status and the service's code", async () => {
    const { ports } = fakes({
      request: () => {
        throw new ApiRefusal("forbidden", 403)
      },
    })
    expect(errorOf(await sdkWith(ports).devices.list())).toMatchObject({
      code: "service_refused",
      details: { status: 403, code: "forbidden" },
    })
  })

  test("#given a locked keychain #when a read runs #then it answers credential_store_locked", async () => {
    const { ports } = fakes()
    const locked: OmoSdkPorts = {
      ...ports,
      credentialStore: {
        read: async () => {
          throw new KeychainLockedError("locked")
        },
      },
    }
    expect(errorOf(await sdkWith(locked).account.whoami()).code).toBe("credential_store_locked")
  })

  test("#given an unreachable service #when a read runs #then it answers service_unreachable", async () => {
    const { ports } = fakes({
      request: () => {
        throw new RequestFailure(true)
      },
    })
    expect(errorOf(await sdkWith(ports).account.whoami()).code).toBe("service_unreachable")
  })

  test("#given a closed SDK #when a read runs #then it answers internal_error and makes no request", async () => {
    const { ports, calls } = fakes()
    const sdk = sdkWith(ports)
    sdk.close()
    expect(errorOf(await sdk.devices.list()).code).toBe("internal_error")
    expect(calls).toEqual([])
  })
})

describe("deviceService.status", () => {
  test("#given no service listening #when status runs #then it answers not_running", async () => {
    const { ports } = fakes()
    const sdk = sdkWith({
      ...ports,
      deviceServiceStatus: async () => "not_running",
    })
    expect(valueOf(await sdk.deviceService.status())).toEqual({ state: "not_running", connected: false, device: null })
  })

  test("#given a service that does not answer in time #when status runs #then it answers no_answer, not offline", async () => {
    const { ports } = fakes()
    const sdk = sdkWith({ ...ports, deviceServiceStatus: async () => "no_answer" })
    expect(valueOf(await sdk.deviceService.status())).toEqual({ state: "no_answer", connected: false, device: null })
  })

  test("#given a caller signal #when status runs #then the port receives that signal", async () => {
    const { ports } = fakes()
    const seen: (AbortSignal | undefined)[] = []
    const controller = new AbortController()
    const sdk = sdkWith({
      ...ports,
      deviceServiceStatus: async ({ signal }) => {
        seen.push(signal)
        return "no_answer"
      },
    })
    await sdk.deviceService.status({ signal: controller.signal })
    expect(seen).toEqual([controller.signal])
  })

  test("#given OMO_DEVICE_SERVICE_STATE_DIR #when status runs #then the probe reads that state dir", async () => {
    const { ports } = fakes()
    const stateDirs: string[] = []
    const sdk = createOmoSdk({
      env: { OMO_DEVICE_SERVICE_STATE_DIR: "/var/lib/omo-device-service" },
      ports: {
        ...ports,
        deviceServiceStatus: async ({ stateDir }) => {
          stateDirs.push(stateDir)
          return { state: "offline", device: null }
        },
      },
    })
    expect(valueOf(await sdk.deviceService.status()).state).toBe("offline")
    expect(stateDirs).toEqual(["/var/lib/omo-device-service"])
  })

  test("#given a service that fails its proof #when status runs #then it answers device_service_unavailable with the code", async () => {
    const { ports } = fakes()
    const sdk = sdkWith({
      ...ports,
      deviceServiceStatus: async () => {
        throw new LocalApiError("server_proof_invalid", "proof failed")
      },
    })
    expect(errorOf(await sdk.deviceService.status())).toMatchObject({
      code: "device_service_unavailable",
      details: { code: "server_proof_invalid" },
    })
  })
})

describe("config.status", () => {
  test("#given an unparsable user config #when status runs #then the file is listed unloaded with its parse diagnostic", async () => {
    const home = mkdtempSync(join(tmpdir(), "omo-sdk-config-"))
    homes.push(home)
    mkdirSync(join(home, ".omo"))
    const configPath = join(home, ".omo", "omo.jsonc")
    writeFileSync(configPath, "{ not json")
    const status = valueOf(await createOmoSdk({ env: { HOME: home }, cwd: home }).config.status())
    expect(status.files).toContainEqual({ path: configPath, scope: "user", exists: true, loaded: false })
    expect(status.diagnostics).toContainEqual(expect.objectContaining({ kind: "parse", path: configPath }))
  })
})
