import { describe, expect, test } from "bun:test"
import { ApiRefusal, type Credentials } from "@oh-my-opencode/omo-opencode/service-auth"
import { createOmoSdk, type OmoResult, type OmoSdkPorts, type SignInProcess, type UserCode } from "."

const ORIGIN = "https://accounts.example.test"
const code: UserCode = {
  verificationUri: "https://signin.example.test/device?code=BCDF-GHJK",
  userCode: "BCDF-GHJK",
  matchingCode: "482 913",
  expiresAt: "2030-01-01T00:05:00.000Z",
}

type Run = {
  readonly args: readonly string[]
  readonly stdin: string
  readonly env: Readonly<Record<string, string | undefined>>
}

function scripted(lines: readonly unknown[], exit = 0): { process: SignInProcess; runs: Run[] } {
  const runs: Run[] = []
  return {
    runs,
    process: async ({ args, stdin, env, onLine }) => {
      runs.push({ args, stdin, env })
      for (const line of lines) onLine(typeof line === "string" ? line : JSON.stringify(line))
      return { code: exit }
    },
  }
}

const sdkWith = (ports: OmoSdkPorts) =>
  createOmoSdk({
    env: { OMO_SERVICE_API_URL: ORIGIN, PATH: "/usr/bin" },
    ports: { desktopLaunch: () => false, ...ports },
  })

const errorOf = <T>(result: OmoResult<T>) => {
  if (result.kind !== "error") throw new Error(`expected an error, got ${JSON.stringify(result)}`)
  return result.error
}

describe("account.signIn", () => {
  test("#given the sign-in verb approves #when signIn runs #then onUserCode gets the code once and the device comes back", async () => {
    const { process, runs } = scripted([
      { event: "code", ...code },
      "a stray line that is not JSON",
      { event: "code", ...code, userCode: "ZZZZ-ZZZZ" },
      { event: "signed_in", api: ORIGIN, device: { id: "dev-new", name: "device-b" }, deviceService: "on" },
    ])
    const shown: UserCode[] = []
    const result = await sdkWith({ signInProcess: process }).account.signIn({
      onUserCode: (value) => {
        shown.push(value)
      },
      deviceName: "device-b",
      replace: true,
    })
    expect(result).toEqual({
      kind: "ok",
      value: { device: { id: "dev-new", name: "device-b" }, deviceService: "on" },
    })
    expect(shown).toEqual([code])
    expect(runs.map((run) => run.args)).toEqual([["account", "sign-in", "--stdin"]])
    expect(runs.map((run) => JSON.parse(run.stdin))).toEqual([{ deviceName: "device-b", replace: true }])
    expect(runs[0]?.env["OMO_SERVICE_API_URL"]).toBe(ORIGIN)
  })

  test("#given the verb refuses with the device limit #when signIn runs #then device_limit carries the devices", async () => {
    const devices = [{ id: "dev-a", name: "device-a" }]
    const { process } = scripted([
      { event: "code", ...code },
      { event: "refused", code: "device_limit", message: "limit", next_action: "remove one", details: { devices } },
    ])
    const error = errorOf(await sdkWith({ signInProcess: process }).account.signIn({ onUserCode: () => undefined }))
    expect(error).toMatchObject({ code: "device_limit", details: { devices } })
  })

  test("#given the verb exits without an outcome #when signIn runs #then it answers internal_error", async () => {
    const { process } = scripted([{ event: "code", ...code }], 1)
    expect(
      errorOf(await sdkWith({ signInProcess: process }).account.signIn({ onUserCode: () => undefined })).code,
    ).toBe("internal_error")
  })

  test("#given an engine the omo launcher did not start #when signIn runs #then it refuses without running anything", async () => {
    const sdk = createOmoSdk({ env: {}, ports: { desktopLaunch: () => false } })
    expect(errorOf(await sdk.account.signIn({ onUserCode: () => undefined })).code).toBe("internal_error")
  })

  test("#given a desktop launch #when signIn runs #then it answers desktop_sign_in and runs no process", async () => {
    const { process, runs } = scripted([])
    const result = await sdkWith({ signInProcess: process, desktopLaunch: () => true }).account.signIn({
      onUserCode: () => undefined,
    })
    expect(errorOf(result).code).toBe("desktop_sign_in")
    expect(runs).toEqual([])
  })
})

const stored: Credentials = {
  accessToken: "access-fixture",
  accessTokenExpiresAt: "2030-01-01T00:00:00.000Z",
  refreshToken: "refresh-fixture",
  device: { id: "dev-a", name: "device-a" },
  signingPrivateKey: "signing-fixture",
  sealingPrivateKey: "sealing-fixture",
}

function account(initial: Record<string, string>) {
  const names = new Map(Object.entries(initial))
  const requests: { method: string; path: string; body?: unknown }[] = []
  const ports: OmoSdkPorts = {
    credentialStore: { read: async () => stored },
    session: {
      accessToken: async () => "access-fixture",
      request: async (path, init) => {
        const method = init.method ?? "GET"
        const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined
        requests.push({ method, path, ...(body === undefined ? {} : { body }) })
        if (method === "PATCH") {
          const id = decodeURIComponent(path.slice("/v1/devices/".length))
          if (!names.has(id)) throw new ApiRefusal("not_found", 404)
          names.set(id, body.name)
          return { device: { id, name: body.name } }
        }
        return { devices: [...names].map(([id, name]) => ({ id, name, revokedAt: null, current: id === "dev-a" })) }
      },
    },
  }
  return { ports, requests, names }
}

describe("devices.rename", () => {
  test("#given a device of the account #when renamed #then the list read back names it and one PATCH was sent", async () => {
    const { ports, requests } = account({ "dev-a": "device-a", "dev-b": "device-b" })
    const result = await sdkWith(ports).devices.rename({ id: "dev-b", name: "device-b2" })
    expect(result).toEqual({ kind: "ok", value: { id: "dev-b", name: "device-b2", current: false } })
    expect(requests.filter((request) => request.method === "PATCH")).toEqual([
      { method: "PATCH", path: "/v1/devices/dev-b", body: { name: "device-b2" } },
    ])
  })

  test("#given an id the account does not have #when renamed #then not_found and every name is unchanged", async () => {
    const { ports, names } = account({ "dev-a": "device-a" })
    const result = await sdkWith(ports).devices.rename({ id: "dev-missing", name: "anything" })
    expect(errorOf(result).code).toBe("not_found")
    expect(Object.fromEntries(names)).toEqual({ "dev-a": "device-a" })
  })
})
