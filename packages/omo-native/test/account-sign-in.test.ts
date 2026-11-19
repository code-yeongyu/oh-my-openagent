import { describe, expect, test } from "bun:test"
import { createSession } from "../../omo-opencode/src/cli/service-auth/session"
import {
  clock,
  fakeApi,
  grant,
  limitDetail,
  memorySecrets,
  minted,
  refusal,
  temporaryHome,
} from "../../omo-opencode/src/cli/service-auth/test-support"
import { ACCOUNT_EXIT, runAccountVerb } from "../account-cli"
import { runSignInVerb, type SignInEvent } from "../account-sign-in"

type Answer = Response | undefined

async function signIn(
  handler: (request: Request, path: string) => Answer | Promise<Answer>,
  flags: readonly string[] = [],
  stdin = "",
) {
  const time = clock()
  const secrets = memorySecrets()
  const requests: { method: string; path: string }[] = []
  const api = fakeApi(async (request) => {
    const path = new URL(request.url).pathname
    requests.push({ method: request.method, path })
    if (path === "/v1/health") return Response.json({ ok: true })
    return (await handler(request, path)) ?? refusal("not_found", undefined, 404)
  })
  const store = secrets.store(api)
  const lines: string[] = []
  const setups: string[] = []
  const code = await runSignInVerb(
    {
      api,
      store,
      session: createSession({ api, store, home: await temporaryHome(), beforeKeysDiscarded: async () => undefined }),
      setUpDeviceService: async () => {
        setups.push("setup")
        return "on"
      },
      readStdin: async () => stdin,
      output: (line) => lines.push(line),
      error: () => undefined,
      ...time,
    },
    flags,
  )
  const events = lines.map((line) => JSON.parse(line) as SignInEvent)
  return { api, code, lines, events, requests, setups, time, stored: await store.read() }
}

const pollThen = (answers: Array<() => Response>) => (_request: Request, path: string) => {
  if (path === "/v1/device/code") return Response.json(minted)
  if (path === "/v1/device/token") return (answers.shift() ?? (() => refusal("invalid_grant")))()
  return undefined
}

describe("omo account sign-in", () => {
  test("#given approval after two pending polls #when it runs #then one code event, the sign-in stored, then signed_in naming the origin", async () => {
    const run = await signIn(
      pollThen([
        () => refusal("authorization_pending"),
        () => refusal("authorization_pending"),
        () => Response.json(grant),
      ]),
    )
    expect(run.code).toBe(ACCOUNT_EXIT.ok)
    expect(run.events).toEqual([
      {
        event: "code",
        verificationUri: minted.verificationUri,
        userCode: minted.userCode,
        matchingCode: minted.matchingCode,
        expiresAt: minted.expiresAt,
      },
      { event: "signed_in", api: run.api, device: grant.device, deviceService: "on" },
    ])
    expect(run.setups).toEqual(["setup"])
    expect(run.stored?.device.id).toBe(grant.device.id)
    expect(run.time.delays).toEqual([5000, 5000, 5000])
  })

  test("#given a successful sign-in #when stdout is scanned by value #then no device code, token or private key is in it", async () => {
    const run = await signIn(pollThen([() => Response.json(grant)]))
    const stdout = run.lines.join("\n")
    const secrets = [
      minted.deviceCode,
      grant.accessToken,
      grant.refreshToken,
      grant.offlineGrant,
      run.stored?.signingPrivateKey ?? "missing",
      run.stored?.sealingPrivateKey ?? "missing",
    ]
    expect(secrets.filter((secret) => stdout.includes(secret))).toEqual([])
    expect(run.lines.every((line) => typeof JSON.parse(line) === "object")).toBe(true)
  })

  test("#given slow_down #when it polls #then the interval grows by five seconds", async () => {
    const run = await signIn(pollThen([() => refusal("slow_down"), () => Response.json(grant)]))
    expect(run.time.delays).toEqual([5000, 10000])
  })

  test("#given nobody approves #when the code expires #then approval_expired with no real wait and nothing stored", async () => {
    const run = await signIn(pollThen(Array.from({ length: 100 }, () => () => refusal("authorization_pending"))))
    expect(run.code).toBe(ACCOUNT_EXIT.failed)
    expect(run.events.at(-1)).toMatchObject({ event: "refused", code: "approval_expired" })
    expect(run.stored).toBeNull()
    expect(run.setups).toEqual([])
  })

  test("#given a denied approval #when it polls #then approval_denied", async () => {
    const run = await signIn(pollThen([() => refusal("access_denied")]))
    expect(run.events.at(-1)).toMatchObject({ event: "refused", code: "approval_denied" })
  })

  test("#given the device limit #when it polls #then device_limit lists the live devices and nothing is deleted", async () => {
    const run = await signIn((request, path) => {
      if (path === "/v1/device/code") return Response.json(minted)
      if (path === "/v1/device/token") return refusal("entitlement_required", limitDetail, 403)
      if (path === "/v1/devices" && request.method === "GET")
        return Response.json({
          devices: [
            { id: "dev-a", name: "device-a", revokedAt: null },
            { id: "dev-b", name: "device-b", revokedAt: null },
            { id: "dev-gone", name: "device-c", revokedAt: "2030-01-01T00:00:00.000Z" },
          ],
        })
      return undefined
    })
    expect(run.events.at(-1)).toEqual({
      event: "refused",
      code: "device_limit",
      message: expect.any(String),
      next_action: expect.any(String),
      details: {
        devices: [
          { id: "dev-a", name: "device-a" },
          { id: "dev-b", name: "device-b" },
        ],
      },
    })
    expect(run.requests.filter((request) => request.method === "DELETE")).toEqual([])
  })

  test("#given this machine already has a device #when replace is not asked #then machine_exists names it", async () => {
    const run = await signIn(
      pollThen([() => refusal("machine_exists", { deviceId: "dev-old", deviceName: "device-old" }, 409)]),
    )
    expect(run.code).toBe(ACCOUNT_EXIT.conflict)
    expect(run.events.at(-1)).toMatchObject({
      event: "refused",
      code: "machine_exists",
      details: { deviceId: "dev-old", deviceName: "device-old" },
    })
  })

  test("#given an unreachable service #when it starts #then accounts_unreachable before any code", async () => {
    const api = "http://127.0.0.1:9"
    const credentials = memorySecrets().store(api)
    const lines: string[] = []
    const code = await runSignInVerb(
      {
        api,
        store: credentials,
        session: createSession({
          api,
          store: credentials,
          home: await temporaryHome(),
          beforeKeysDiscarded: async () => undefined,
        }),
        setUpDeviceService: async () => "on",
        readStdin: async () => "",
        output: (line) => lines.push(line),
        error: () => undefined,
      },
      [],
    )
    expect(code).toBe(ACCOUNT_EXIT.failed)
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({ event: "refused", code: "accounts_unreachable" }),
    ])
  })

  test("#given options on stdin #when it runs #then the device name reaches the code request and nothing is on argv", async () => {
    const names: unknown[] = []
    const run = await signIn(
      async (request, path) => {
        if (path === "/v1/device/code") {
          const body = (await request.json()) as { client: { name: string } }
          names.push(body.client.name)
          return Response.json(minted)
        }
        if (path === "/v1/device/token") return Response.json(grant)
        return undefined
      },
      ["--stdin"],
      JSON.stringify({ deviceName: "device-b" }),
    )
    expect(run.code).toBe(ACCOUNT_EXIT.ok)
    expect(names).toEqual(["device-b"])
  })

  test("#given a malformed stdin options line #when it runs #then it answers usage and sends nothing", async () => {
    const run = await signIn(() => undefined, ["--stdin"], '{"deviceName": 5}')
    expect(run.code).toBe(ACCOUNT_EXIT.invalid)
    expect(run.lines).toEqual([])
    expect(run.requests).toEqual([])
  })

  test("#given an unknown flag #when the verb is dispatched #then it answers usage and signs nothing in", async () => {
    const errors: string[] = []
    const out: string[] = []
    const secrets = memorySecrets()
    const code = await runAccountVerb(
      {
        api: "http://127.0.0.1:9",
        store: secrets.store("http://127.0.0.1:9"),
        pinDir: () => "/nonexistent",
        readStdin: async () => "",
        output: (line) => out.push(line),
        error: (line) => errors.push(line),
      },
      ["sign-in", "--api", "https://elsewhere.example"],
    )
    expect(code).toBe(ACCOUNT_EXIT.invalid)
    expect(out).toEqual([])
    expect(errors).toHaveLength(1)
  })
})
