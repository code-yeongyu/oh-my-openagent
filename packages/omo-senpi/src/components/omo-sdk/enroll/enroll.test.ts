import { describe, expect, test } from "bun:test"
import type { UserCode } from "../account/sign-in"
import { type EnrollPorts, enrollDevice, READ_BACK_DEADLINE_MS, type RemoteProgram, type SshExit } from "."
import { remoteCommand } from "./ssh-port"

const ORIGIN = "https://accounts.example.test"
const code: UserCode = {
  verificationUri: "https://signin.example.test/device?code=BCDF-GHJK",
  userCode: "BCDF-GHJK",
  matchingCode: "482 913",
  expiresAt: "2030-01-01T00:05:00.000Z",
}
const SECRETS = ["dc.secret-device-code", "access-token-fixture", "refresh-token-fixture", "private-key-fixture"]

type Script = { readonly lines: readonly string[]; readonly exit: SshExit }
type Scripts = Partial<Record<RemoteProgram["kind"], Script | Script[]>>

const ok = (lines: readonly string[]): Script => ({ lines, exit: { code: 0 } })
const json = (value: unknown) => JSON.stringify(value)
const preflightLinux = ok(["Linux", "x86_64", "omo:present", "Linger=yes"])
const ready = ok([json({ event: "ready" })])
const signedOut = { lines: [json({ signedIn: false })], exit: { code: 4 } } satisfies Script
const signedIn = (deviceService = "on") =>
  ok([
    json({ event: "code", ...code }),
    json({ event: "signed_in", device: { id: "dev-new", name: "device-b" }, deviceService }),
  ])

function world(scripts: Scripts, overrides: Partial<EnrollPorts> & { readonly onlineAfterMs?: number } = {}) {
  const opened: { kind: RemoteProgram["kind"]; command: string; stdin: string[] }[] = []
  let now = 0
  const sleeps: number[] = []
  const queue = new Map<string, Script[]>(
    Object.entries(scripts).map(([kind, script]) => [kind, Array.isArray(script) ? [...script] : [script]]),
  )
  const ports: EnrollPorts = {
    origin: ORIGIN,
    ssh: () => ({
      open: (program) => {
        const script = queue.get(program.kind)?.shift()
        if (script === undefined) throw new Error(`unscripted remote program ${program.kind}`)
        const record = { kind: program.kind, command: remoteCommand(program), stdin: [] as string[] }
        opened.push(record)
        return {
          lines: (async function* () {
            yield* script.lines
          })(),
          write: (line) => {
            record.stdin.push(line)
          },
          end: () => undefined,
          exit: Promise.resolve(script.exit),
        }
      },
    }),
    liveDeviceIds: async () => (now >= (overrides.onlineAfterMs ?? 0) ? ["dev-a", "dev-new"] : ["dev-a"]),
    isDeviceRevoked: async () => false,
    machines: async () => [
      { id: "dev-new", state: now >= (overrides.onlineAfterMs ?? 0) ? ("online" as const) : ("offline" as const) },
    ],
    doriterm: async () => ({ code: null, lines: [] }),
    clock: {
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms)
        now += ms
      },
    },
    ...overrides,
  }
  return { ports, opened, sleeps, kinds: () => opened.map((entry) => entry.kind) }
}

const shown: UserCode[] = []
const request = (extra: Record<string, unknown> = {}) => ({
  ssh: { host: "target.example.test", user: "ops" },
  onUserCode: (value: UserCode) => {
    shown.push(value)
  },
  ...extra,
})

describe("enrollDevice", () => {
  test("#given a reachable signed-out target with omo #when enrolled #then every step is ok and the code is shown once", async () => {
    shown.length = 0
    const w = world(
      { preflight: preflightLinux, sign_in_check: ready, account_show: signedOut, sign_in: signedIn() },
      { onlineAfterMs: 10_000 },
    )
    const outcome = await enrollDevice(request({ deviceName: "device-b" }), w.ports)
    expect(outcome).toMatchObject({
      kind: "enrolled",
      api: ORIGIN,
      already: false,
      device: { id: "dev-new", name: "device-b", platform: "linux" },
    })
    expect(outcome.steps.map((step) => [step.step, step.outcome])).toEqual([
      ["request", "ok"],
      ["reach", "ok"],
      ["preflight", "ok"],
      ["install", "skipped"],
      ["account_state", "ok"],
      ["sign_in", "ok"],
      ["device_service", "ok"],
      ["read_back", "ok"],
    ])
    expect(shown).toEqual([code])
    expect(w.kinds()).toEqual(["preflight", "sign_in_check", "account_show", "sign_in"])
    expect(w.opened.find((entry) => entry.kind === "sign_in")?.stdin).toEqual([json({ deviceName: "device-b" })])
    expect(w.sleeps).toEqual([5000, 5000])
  })

  test("#given a target without omo #when enrolled #then the install line runs and the verb is checked again", async () => {
    const w = world({
      preflight: ok(["Linux", "aarch64", "omo:absent", "Linger=yes"]),
      install: ok([]),
      sign_in_check: ready,
      account_show: signedOut,
      sign_in: signedIn(),
    })
    const outcome = await enrollDevice(request(), w.ports)
    expect(outcome.kind).toBe("enrolled")
    expect(w.kinds()).toEqual(["preflight", "install", "sign_in_check", "account_show", "sign_in"])
  })

  test("#given a target already enrolled on this account #when enrolled #then already: true with no install and no code", async () => {
    shown.length = 0
    const w = world({
      preflight: preflightLinux,
      sign_in_check: ready,
      account_show: ok([json({ signedIn: true, device: { id: "dev-new", name: "device-b" } })]),
    })
    const outcome = await enrollDevice(request(), w.ports)
    expect(outcome).toMatchObject({ kind: "enrolled", already: true, device: { id: "dev-new" } })
    expect(shown).toEqual([])
    expect(w.kinds()).not.toContain("sign_in")
    expect(w.kinds()).not.toContain("install")
  })

  test("#given a target signed in to another account #when enrolled #then signed_in_elsewhere and no sign-in", async () => {
    const w = world({
      preflight: preflightLinux,
      sign_in_check: ready,
      account_show: ok([json({ signedIn: true, device: { id: "dev-foreign", name: "x" } })]),
    })
    const outcome = await enrollDevice(request(), w.ports)
    expect(outcome).toMatchObject({ kind: "refused", step: "account_state", code: "signed_in_elsewhere" })
    expect(w.kinds()).not.toContain("sign_in")
  })

  test("#given a target holding a revoked device of this account #when enrolled #then device_revoked_here", async () => {
    const w = world(
      {
        preflight: preflightLinux,
        sign_in_check: ready,
        account_show: ok([json({ signedIn: true, device: { id: "dev-old", name: "x" } })]),
      },
      { isDeviceRevoked: async (id) => id === "dev-old" },
    )
    expect(await enrollDevice(request(), w.ports)).toMatchObject({ code: "device_revoked_here" })
  })

  test("#given a target with no credential store #when enrolled #then credential_store_unavailable and zero sign-in commands", async () => {
    const w = world({
      preflight: preflightLinux,
      sign_in_check: ready,
      account_show: { lines: [json({ keychain: "unavailable" })], exit: { code: 8 } },
    })
    const outcome = await enrollDevice(request(), w.ports)
    expect(outcome).toMatchObject({ kind: "refused", step: "account_state", code: "credential_store_unavailable" })
    expect(w.kinds().filter((kind) => kind === "sign_in")).toEqual([])
  })

  test("#given the device limit #when the target signs in #then device_limit carries the devices", async () => {
    const devices = [{ id: "dev-a", name: "device-a" }]
    const w = world({
      preflight: preflightLinux,
      sign_in_check: ready,
      account_show: signedOut,
      sign_in: ok([
        json({ event: "code", ...code }),
        json({ event: "refused", code: "device_limit", details: { devices } }),
      ]),
    })
    expect(await enrollDevice(request(), w.ports)).toMatchObject({
      step: "sign_in",
      code: "device_limit",
      details: { devices },
    })
  })

  test("#given a device service kept off #when signed in #then device_service_off", async () => {
    const w = world({
      preflight: preflightLinux,
      sign_in_check: ready,
      account_show: signedOut,
      sign_in: signedIn("kept_off"),
    })
    expect(await enrollDevice(request(), w.ports)).toMatchObject({ step: "device_service", code: "device_service_off" })
  })

  test("#given a device that never comes online #when read back #then not_online_before_deadline on the virtual clock", async () => {
    const w = world(
      {
        preflight: ok(["Linux", "x86_64", "omo:present", "Linger=no"]),
        sign_in_check: ready,
        account_show: signedOut,
        sign_in: signedIn(),
      },
      { onlineAfterMs: Number.POSITIVE_INFINITY },
    )
    const outcome = await enrollDevice(request(), w.ports)
    expect(outcome).toMatchObject({
      kind: "refused",
      step: "read_back",
      code: "not_online_before_deadline",
      details: { deviceId: "dev-new", listed: false, machine: "offline", sessionBound: true },
    })
    expect(w.sleeps.reduce((sum, ms) => sum + ms, 0)).toBe(READ_BACK_DEADLINE_MS)
  })

  test("#given an aborted signal #when enrolled #then it stops at the current step and runs nothing more", async () => {
    const controller = new AbortController()
    const w = world({ preflight: preflightLinux, sign_in_check: ready, account_show: signedOut })
    controller.abort()
    const outcome = await enrollDevice(request({ signal: controller.signal }), w.ports)
    expect(outcome).toMatchObject({ kind: "refused", step: "reach", code: "aborted" })
    expect(w.kinds()).toEqual([])
  })

  test("#given an unreachable target #when enrolled #then ssh_unreachable at reach and no later step", async () => {
    const w = world({ preflight: { lines: [], exit: { code: 255, sshFailure: "unreachable" } } })
    expect(await enrollDevice(request(), w.ports)).toMatchObject({ step: "reach", code: "ssh_unreachable" })
    expect(w.kinds()).toEqual(["preflight"])
  })

  test("#given a changed host key #when enrolled #then ssh_host_unverified and no later step", async () => {
    const w = world({ preflight: { lines: [], exit: { code: 255, sshFailure: "host_unverified" } } })
    expect(await enrollDevice(request(), w.ports)).toMatchObject({ step: "reach", code: "ssh_host_unverified" })
    expect(w.kinds()).toEqual(["preflight"])
  })

  test("#given a host or user starting with - #when enrolled #then invalid_request before any connection", async () => {
    for (const ssh of [{ host: "-oProxyCommand=x" }, { host: "target.example.test", user: "-x" }]) {
      const w = world({})
      expect(await enrollDevice({ ...request(), ssh }, w.ports)).toMatchObject({
        step: "request",
        code: "invalid_request",
      })
      expect(w.kinds()).toEqual([])
    }
  })

  test("#given an unsupported platform #when enrolled #then unsupported_platform and no install", async () => {
    const w = world({ preflight: ok(["FreeBSD", "x86_64", "omo:absent", "Linger=unknown"]) })
    expect(await enrollDevice(request(), w.ports)).toMatchObject({ step: "preflight", code: "unsupported_platform" })
    expect(w.kinds()).toEqual(["preflight"])
  })

  test("#given a non-default origin #when enrolled #then the target's account commands run against that origin", async () => {
    const w = world({ preflight: preflightLinux, sign_in_check: ready, account_show: signedOut, sign_in: signedIn() })
    const outcome = await enrollDevice(request(), w.ports)
    expect(outcome.api).toBe(ORIGIN)
    for (const entry of w.opened.filter((opened) => opened.kind !== "preflight"))
      expect(entry.command).toContain(`OMO_SERVICE_API_URL='${ORIGIN}'`)
  })

  test("#given secrets in remote output #when enrolled #then no argv, stdin or returned value carries them", async () => {
    const leaky = ok([
      json({ event: "code", ...code, deviceCode: SECRETS[0] }),
      `noise ${SECRETS[1]} ${SECRETS[3]}`,
      json({ event: "signed_in", device: { id: "dev-new", name: "device-b" }, deviceService: "on", token: SECRETS[2] }),
    ])
    shown.length = 0
    const w = world({ preflight: preflightLinux, sign_in_check: ready, account_show: signedOut, sign_in: leaky })
    const outcome = await enrollDevice(request(), w.ports)
    const seen = JSON.stringify({ outcome, commands: w.opened })
    expect(SECRETS.filter((secret) => seen.includes(secret))).toEqual([])
    expect([code.userCode, code.matchingCode].filter((value) => seen.includes(value))).toEqual([])
    expect(shown).toEqual([code])
  })
})

describe("remoteCommand", () => {
  test("#given an origin that is not a plain https origin #when a command is built #then it throws before any spawn", () => {
    expect(() => remoteCommand({ kind: "account_show", origin: "https://x.test/'; rm -rf ~; '" })).toThrow()
  })
})
