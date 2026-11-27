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
import { closeClients, fakeClock, startOwner } from "../remote/testing/fake-service"
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
afterEach(async () => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
  await closeClients()
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

  test("#given the account lists a revoked device #when account.devices runs #then only live devices return with the account's own fields, this one current", async () => {
    const { ports } = fakes()
    expect(valueOf(await sdkWith(ports).account.devices())).toEqual([
      { id: "dev_this", name: "device-a", kind: "cli", platform: "linux", current: true },
      { id: "dev_other", name: "device-b", platform: "macos", machineBound: true, current: false },
    ])
  })

  test("#given every read #when its value is scanned by key and value #then no token, secret or private key is in it", async () => {
    const { ports } = fakes()
    const home = mkdtempSync(join(tmpdir(), "omo-sdk-home-"))
    homes.push(home)
    const owner = await startOwner()
    const env = { OMO_SERVICE_API_URL: ORIGIN, HOME: home, OMO_DEVICE_SERVICE_STATE_DIR: owner.stateDir }
    const sdk = createOmoSdk({ env, cwd: home, home, ports: { ...ports, remoteTimers: fakeClock() } })
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
    const error = errorOf(await sdkWith(ports).account.whoami())
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
    const result = await sdkWith(ports).account.whoami()
    expect(errorOf(result)).toMatchObject({ code: "session_ended", details: { code: "unauthorized" } })
    expect(secretKeys(result)).toEqual([])
  })

  test("#given another refusal #when a read runs #then it answers service_refused with the status and the service's code", async () => {
    const { ports } = fakes({
      request: () => {
        throw new ApiRefusal("forbidden", 403)
      },
    })
    expect(errorOf(await sdkWith(ports).account.whoami())).toMatchObject({
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
  test("#given an unparsable user config #when status runs #then the file is listed by scope, unloaded, with one parse diagnostic", async () => {
    const home = mkdtempSync(join(tmpdir(), "omo-sdk-config-"))
    homes.push(home)
    mkdirSync(join(home, ".omo"))
    writeFileSync(join(home, ".omo", "omo.jsonc"), "{ not json")
    const status = valueOf(await createOmoSdk({ env: { HOME: home }, cwd: home }).config.status())
    expect(status.files).toContainEqual({ scope: "user", exists: true, loaded: false })
    expect(status.diagnostics).toContainEqual({ kind: "parse", count: 1 })
  })

  // Security contract (the security owner's ruling): the SDK reports the configuration by scope, kind and count. No key
  // name, key path, value, parse excerpt or file path from a config file reaches an SDK caller; the command a person
  // runs (its configuration check) keeps the full text.
  test("#given user and project configs with unknown keys, a wrong-typed value and a parse error #when status runs #then the answer names none of them and no file path", async () => {
    const home = mkdtempSync(join(tmpdir(), "zz-canary-home-"))
    homes.push(home)
    const project = join(home, "zz-canary-project")
    mkdirSync(join(home, ".omo"))
    mkdirSync(join(project, ".omo"), { recursive: true })
    writeFileSync(
      join(home, ".omo", "omo.jsonc"),
      JSON.stringify({
        zz_canary_top_key: 1,
        task: { host_engine_policy: "zz-canary-value", zz_canary_nested_key: true },
        agents: { zz_canary_agent: { model: "anthropic/claude-opus-5", zz_canary_agent_key: true } },
      }),
    )
    writeFileSync(join(project, ".omo", "omo.jsonc"), '{ "zz_canary_parse_excerpt": ')
    const status = valueOf(await createOmoSdk({ env: { HOME: home }, cwd: project }).config.status())
    expect(JSON.stringify(status).match(/zz[_-]canary[\w-]*/g) ?? []).toEqual([])
    expect(status.files.every((file) => Object.keys(file).sort().join() === "exists,loaded,scope")).toBe(true)
    expect(status.diagnostics.every((entry) => Object.keys(entry).sort().join() === "count,kind")).toBe(true)
    expect(status.diagnostics.map((entry) => entry.kind)).toEqual(
      expect.arrayContaining(["unknown-keys", "invalid-value", "parse"]),
    )
  })

  // The same contract over nine shapes of file text (the security reader's variants): each body is written into both the
  // user file and the project file, and the whole serialized answer, or a thrown error's message, carries no canary
  // token and no absolute path.
  const VARIANTS: readonly (readonly [string, string])[] = [
    ["values under unknown keys", JSON.stringify({ providers: { x: { apiKey: "CANARY-VALUE-1" } } })],
    ["a canary as a top-level key name", JSON.stringify({ "CANARY-KEYNAME-2": 1 })],
    ["a canary as a nested key name", JSON.stringify({ agents: { "CANARY-KEYNAME-3": { model: "m" } } })],
    ["a syntax error right after a canary value", '{ "apiKey": "CANARY-VALUE-4" oops }'],
    ["a syntax error inside a canary token", '{ "a": CANARY-VALUE-5 }'],
    [
      "a known-looking key with a wrong type holding a canary",
      JSON.stringify({
        model: { nested: "CANARY-VALUE-6" },
        agents: "CANARY-VALUE-7",
        categories: ["CANARY-VALUE-8"],
        disabled_hooks: "CANARY-VALUE-9",
        mcp: "CANARY-VALUE-10",
        $schema: "https://u:CANARY-VALUE-11@example.test/s.json",
      }),
    ],
    [
      "a string where an enum is expected",
      JSON.stringify({
        agents: { build: { model: "CANARY-VALUE-12", reasoning: "CANARY-VALUE-13", permission: "CANARY-VALUE-14" } },
        default_mode: "CANARY-VALUE-15",
      }),
    ],
    ["a comment holding a canary, then an error", '// CANARY-VALUE-16\n{ "a": }'],
    ["not JSON at all: one line that is a token", "CANARY-VALUE-17"],
  ]
  test("#given a configuration load that throws a canary #when status runs #then it answers the fixed refusal with the class name and none of the thrown text", async () => {
    const home = mkdtempSync(join(tmpdir(), "omo-sdk-config-throw-"))
    homes.push(home)
    const env = new Proxy(
      { HOME: home },
      {
        get(target, key) {
          if (key === "HOME") throw new Error(`CANARY-THROWN-1 at ${home}`)
          return Reflect.get(target, key)
        },
      },
    )
    expect(await createOmoSdk({ env, cwd: home }).config.status()).toEqual({
      kind: "error",
      error: {
        code: "internal_error",
        message: "the omo SDK failed unexpectedly",
        next_action: "retry; report it if it repeats",
        details: { name: "Error" },
      },
    })
  })

  for (const [label, body] of VARIANTS)
    test(`#given ${label} in the user and the project file #when status runs #then the answer carries no canary and no path`, async () => {
      const base = mkdtempSync(join(tmpdir(), "omo-sdk-config-variant-"))
      homes.push(base)
      const home = join(base, "home")
      const project = join(base, "project")
      for (const dir of [join(home, ".omo"), join(project, ".omo")]) mkdirSync(dir, { recursive: true })
      writeFileSync(join(home, ".omo", "omo.jsonc"), body)
      writeFileSync(join(project, ".omo", "omo.jsonc"), body)
      let answer: unknown
      try {
        answer = await createOmoSdk({ env: { HOME: home }, cwd: project }).config.status()
      } catch (error) {
        answer = { threw: error instanceof Error ? error.message : String(error) }
      }
      const text = JSON.stringify(answer)
      expect({ canaries: text.match(/CANARY-[A-Z]+-\d+/g) ?? [], path: text.includes(base) }).toEqual({
        canaries: [],
        path: false,
      })
    })
})
