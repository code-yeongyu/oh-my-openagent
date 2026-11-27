import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"

import { connectDeviceService, DEVICE_SERVICE_VERSION } from "../../device-service-core/src/index.ts"
import type { Status } from "../../device-service-core/src/device-service.ts"
import { deviceServiceAssetName } from "../../device-service-core/src/release/acquire.ts"
import { startFakeOwner } from "../../device-service-core/test/local-api/conformance/fake-owner.ts"
import {
  buildRelease,
  RELEASE_ORIGIN,
  releaseKey,
  serveRelease,
} from "../../device-service-core/test/release-fixture.ts"
import {
  defaultWorld,
  OFFLINE_PEER,
  PEER,
  SESSION_ID,
} from "../../device-service-core/test/local-api/conformance/world.ts"
import { createCredentialStore } from "../../omo-opencode/src/cli/service-auth/keystore"
import type { RemoteClient } from "../../omo-senpi/src/components/remote/index"
import { runAccountVerb } from "../account-cli"
import { deviceServiceBootstrapSetup } from "../remote-bootstrap"
import { prepareRemoteAttach, REMOTE_EXIT } from "../remote-cli"
import { ago, candidateLines } from "../remote-render"
import {
  AGENT_DIR,
  NOW,
  OMO_BINARY,
  owners,
  privateDir,
  run,
  SIGNED_IN,
  useRemoteCliCleanup,
} from "./remote-cli-harness"

useRemoteCliCleanup()

describe("omo remote", () => {
  test("status prints the connection state, and --json prints the person client's service.status value", async () => {
    const human = await run(["status"])
    expect(human.code).toBe(REMOTE_EXIT.ok)
    expect(human.out).toContain("State            Connected")
    expect(human.out).toContain("This device      This Mac")
    expect(human.out).toContain("Service          1.4.0")
    const json = await run(["status", "--json"])
    expect(JSON.parse(json.out.join(""))).toEqual({ ...defaultWorld().status, service_version: "1.4.0" })
  })

  test("devices lists this device first and then each peer with its presence (the service's roster leaves this device out, #13402)", async () => {
    const { code, out } = await run(["devices"])
    expect(code).toBe(REMOTE_EXIT.ok)
    expect(out[0]).toMatch(/^DEVICE\s+NAME\s+KIND\s+PLATFORM\s+SEEN$/)
    // The person client lists this device first (B1 self row), then the account's other devices.
    expect(out[1]).toMatch(new RegExp(`^dev-self\\s+This Mac\\s+this device\\s+${process.platform}\\s+online$`))
    expect(out[2]).toMatch(new RegExp(`^${PEER}\\s+Studio\\s+desktop\\s+darwin\\s+online$`))
    expect(out[3]).toMatch(new RegExp(`^${OFFLINE_PEER}\\s+Laptop\\s+cli\\s+linux\\s+12d ago$`))
    const json = await run(["devices", "--json"])
    const rows = JSON.parse(json.out.join("")) as { id: string; self?: true }[]
    expect(rows.map((row) => [row.id, row.self ?? false])).toEqual([
      ["dev-self", true],
      [PEER, false],
      [OFFLINE_PEER, false],
    ])
  })

  test("devices shows this device offline while its service is not connected, and invents no kind for it", async () => {
    const world = defaultWorld()
    const owner = await startFakeOwner({
      stateDir: privateDir(),
      world: { ...world, status: { ...world.status, state: "offline" } },
    })
    owners.push(owner)
    const { code, out } = await run(["devices"], owner.stateDir)
    expect(code).toBe(REMOTE_EXIT.ok)
    expect(out[1]).toMatch(new RegExp(`^dev-self\\s+This Mac\\s+this device\\s+${process.platform}\\s+never$`))
    const json = await run(["devices", "--json"], owner.stateDir)
    const [here] = JSON.parse(json.out.join("")) as Record<string, unknown>[]
    expect(here).toMatchObject({ id: "dev-self", name: "This Mac", online: false, last_seen_ms: null, self: true })
    expect(here).not.toHaveProperty("kind")
  })

  test("sessions shows attach targets, marks cached rows and names devices that did not answer", async () => {
    const { code, out } = await run(["sessions"])
    expect(code).toBe(REMOTE_EXIT.ok)
    const live = out.find((line) => line.startsWith(`${PEER}/${SESSION_ID}`))
    expect(live).toMatch(/Live session\s+running\s+omo\s+Studio/)
    expect(out.find((line) => line.startsWith(`${OFFLINE_PEER}/${SESSION_ID}`))).toMatch(/running \(cached\)/)
    expect(out.at(-1)).toBe("Not answered, rows may be missing or cached: Laptop")
  })

  test("sessions passes its filter to the service and --json prints the listing result", async () => {
    const { out } = await run(["sessions", "--device", PEER, "--json"])
    const result = JSON.parse(out.join("")) as { rows: { thread: string; device: { id: string } }[] }
    expect(result.rows.map((row) => row.device.id)).toEqual([PEER])
    expect(result.rows.map((row) => row.thread)).toEqual([`${PEER}/${SESSION_ID}`])
  })

  test("sessions --device naming no device of the account is a usage error, not an empty list (#13402)", async () => {
    const typo = await run(["sessions", "--device", "no-such-device", "--json"])
    expect(typo.code).toBe(REMOTE_EXIT.usage)
    expect(typo.out).toEqual([])
    expect(typo.err).toEqual(["omo remote sessions: no device no-such-device on this account (see omo remote devices)"])
    const self = await run(["sessions", "--device", "dev-self", "--json"])
    expect(self.code).toBe(REMOTE_EXIT.ok)
  })

  const ambiguousDeviceClient = (calls: string[]) => ({
    devices: { list: async () => ({ kind: "ok", value: [] }) },
    sessions: {
      list: async () => {
        calls.push("sessions.list")
        return {
          kind: "error",
          code: "ambiguous_target",
          message: "2 online devices are named studio.",
          next_action: "Pass the device id.",
          details: {
            kind: "device",
            candidates: [
              { device: "dev-peer-1", name: "Studio", online: true },
              { device: "dev-peer-3", name: "Studio", online: true },
            ],
          },
        }
      },
    },
    close: () => {},
  })

  test("sessions --device names the candidates of an ambiguous device one per line, on the one call it makes (#14305)", async () => {
    const calls: string[] = []
    const { code, err } = await run(["sessions", "--device", "studio"], privateDir(), undefined, undefined, {
      client: () => ambiguousDeviceClient(calls) as unknown as RemoteClient,
    })
    expect(code).toBe(REMOTE_EXIT.failed)
    expect(err.filter((line) => line.includes("dev-peer-1") !== line.includes("dev-peer-3"))).toHaveLength(2)
    expect(calls).toEqual(["sessions.list"])
  })

  test("sessions --device --json prints an ambiguous device's typed failure with its candidates on stdout (#14305 review M1)", async () => {
    const calls: string[] = []
    const { code, out } = await run(["sessions", "--device", "studio", "--json"], privateDir(), undefined, undefined, {
      client: () => ambiguousDeviceClient(calls) as unknown as RemoteClient,
    })
    expect(code).toBe(REMOTE_EXIT.failed)
    expect(JSON.parse(out.join(""))).toMatchObject({
      kind: "error",
      code: "ambiguous_target",
      details: { candidates: [{ device: "dev-peer-1" }, { device: "dev-peer-3" }] },
    })
    expect(calls).toEqual(["sessions.list"])
  })

  test("sessions --device accepts a device the roster misses when the listing still has its rows", async () => {
    const world = defaultWorld()
    const owner = await startFakeOwner({
      stateDir: privateDir(),
      world: { ...world, devices: world.devices.filter((device) => device.device !== PEER) },
    })
    owners.push(owner)
    const { code, out, err } = await run(["sessions", "--device", PEER, "--json"], owner.stateDir)
    expect(err).toEqual([])
    expect(code).toBe(REMOTE_EXIT.ok)
    const result = JSON.parse(out.join("")) as { rows: { device: { id: string } }[] }
    expect(result.rows.map((row) => row.device.id)).toEqual([PEER])
  })

  test("disable and enable report the switch the service answers with", async () => {
    const off = await run(["disable"])
    expect(off.out).toEqual(["Remote sessions are off for this device."])
    const on = await run(["enable", "--json"])
    expect(JSON.parse(on.out.join(""))).toEqual({ enabled: true })
  })

  test.each([
    [["sessions", "--state", "paused"], "omo remote sessions: --state is one of running, idle, ended"],
    [["devices", "--device", PEER], `omo remote devices: unknown argument --device`],
    [["attach-all"], "omo remote: unknown command attach-all"],
  ])("refuses %p as usage before contacting the service", async (args, message) => {
    const { code, err } = await run(args, join(privateDir(), "absent"))
    expect(code).toBe(REMOTE_EXIT.usage)
    expect(err[0]).toBe(message)
  })

  // D1 (#12051): the per-device opt-out is the host attach control (control.attach.get/set).
  test("control reads the attach setting, and control off/on set it", async () => {
    const owner = await startFakeOwner({ stateDir: privateDir(), world: defaultWorld() })
    owners.push(owner)
    const fresh = await run(["control", "--json"], owner.stateDir)
    expect([fresh.code, JSON.parse(fresh.out.join(""))]).toEqual([REMOTE_EXIT.ok, { attached: true, changedAt: "" }])
    const off = await run(["control", "off"], owner.stateDir)
    expect(off.code).toBe(REMOTE_EXIT.ok)
    expect(off.out[0]).toStartWith("Remote control is off")
    expect(owner.state.attach.attached).toBe(false)
    const after = await run(["control", "--json"], owner.stateDir)
    expect(JSON.parse(after.out.join(""))).toMatchObject({ attached: false })
    const on = await run(["control", "on", "--json"], owner.stateDir)
    expect(JSON.parse(on.out.join(""))).toMatchObject({ attached: true })
    expect(owner.state.attach.attached).toBe(true)
  })

  test("control refuses a value other than on or off before contacting the service", async () => {
    const { code, err } = await run(["control", "maybe"], join(privateDir(), "absent"))
    expect(code).toBe(REMOTE_EXIT.usage)
    expect(err[0]).toBe("omo remote control: the value is on or off")
  })

  test("control names a service too old to have the attach setting instead of sending it", async () => {
    const owner = await startFakeOwner({
      stateDir: privateDir(),
      world: defaultWorld(),
      capabilities: ["sessions", "devices", "enforcement", "upgrade"],
    })
    owners.push(owner)
    const { code, err } = await run(["control", "off"], owner.stateDir)
    expect(code).toBe(REMOTE_EXIT.unavailable)
    expect(err).toEqual([
      "The OmO device service on this device does not have remote control yet. Update OmO, then try again.",
    ])
    expect(owner.state.log).not.toContain("control.attach.set")
  })

  test("reports a missing or stopped service without a stack", async () => {
    const missing = await run(["status"], join(privateDir(), "absent"))
    expect(missing.code).toBe(REMOTE_EXIT.unavailable)
    expect(missing.err).toEqual([
      "The OmO device service is not set up on this device. Install the OmO desktop app to set it up.",
    ])
    const stopped = await run(["status"], privateDir())
    expect(stopped.code).toBe(REMOTE_EXIT.unavailable)
    expect(stopped.err).toEqual(["The OmO device service is not running on this device."])
  })
})

describe("omo remote bootstrap: omo account show first", () => {
  test.each([
    [
      "signed out",
      { exitCode: 0, stdout: '{"signedIn":false}' },
      "Sign in to OmO first: run omo login (or sign in from the OmO desktop app).",
    ],
    [
      "signed out after omo logout",
      { exitCode: 0, stdout: '{"signedIn":false,"signedOut":{"at":"2026-10-30T00:00:00.000Z"}}' },
      "Sign in to OmO first: run omo login (or sign in from the OmO desktop app).",
    ],
    [
      "a locked keychain (exit 7)",
      { exitCode: 7, stdout: '{"keychain":"locked"}' },
      "Your OmO sign-in is behind a locked keychain. Unlock it, then try again.",
    ],
    [
      "an unavailable store (exit 9)",
      { exitCode: 9, stdout: '{"error":"store-unavailable"}' },
      "The credential store holding your OmO sign-in is not available right now. Try again in a moment.",
    ],
    [
      "output that is not JSON",
      { exitCode: 0, stdout: "garbage" },
      "Could not read your OmO sign-in (omo account show printed no JSON). Sign in again with omo login.",
    ],
    [
      "signedIn true with a failing exit",
      { exitCode: 1, stdout: '{"signedIn":true,"device":{"id":"d","name":"n"}}' },
      "Could not read your OmO sign-in (omo account show answered an unexpected shape (exit 1)). Sign in again with omo login.",
    ],
  ])("%s stops before contacting the service", async (_label, account, notice) => {
    const owner = await startFakeOwner({ stateDir: privateDir(), world: defaultWorld() })
    owners.push(owner)
    const { code, err, out } = await run(["status"], owner.stateDir, account)
    expect([code, err, out]).toEqual([REMOTE_EXIT.unavailable, [notice], []])
  })
})

// The start-up bootstrap's worker: one JSON line the engine component reads, exit 0 connected, 3 stopped.
describe("omo remote bootstrap", () => {
  test("a running service at the pin is set up for this sign-in and reports connected", async () => {
    const owner = await startFakeOwner({ stateDir: privateDir(), world: defaultWorld() })
    owners.push(owner)
    const { code, out } = await run(["bootstrap", "--json"], owner.stateDir)
    expect(code).toBe(REMOTE_EXIT.ok)
    expect(JSON.parse(out.join(""))).toMatchObject({ state: "connected", status: { state: "connected" } })
    // Design D r9 section 3: the bootstrap reads no credential and adopts nothing.
    expect(owner.state.adoptions).toBe(0)
    expect(owner.state.refresher).toEqual({ binary_path: OMO_BINARY, version: "5.1.58" })
    expect([...owner.state.endpoints]).toEqual([AGENT_DIR])
  })

  test("signed out stops with the signed_out state and touches no service", async () => {
    const owner = await startFakeOwner({ stateDir: privateDir(), world: defaultWorld() })
    owners.push(owner)
    const { code, out } = await run(["bootstrap", "--json"], owner.stateDir, {
      exitCode: 4,
      stdout: '{"signedIn":false}',
    })
    expect(code).toBe(REMOTE_EXIT.unavailable)
    expect(JSON.parse(out.join(""))).toMatchObject({ state: "signed_out" })
    expect(owner.state.log).toEqual([])
  })

  // A Linux machine with no Secret Service (headless, WSL, containers) has no store, so nothing can prove a sign-in:
  // the worker reports its own store_unavailable state, which the start-up component keeps quiet.
  test("no credential store in an isolated HOME reports store_unavailable and touches no service", async () => {
    const owner = await startFakeOwner({ stateDir: privateDir(), world: defaultWorld() })
    owners.push(owner)
    const home = privateDir()
    const noSecretService = {
      get: async () => {
        throw new Error("Cannot autolaunch D-Bus without X11 $DISPLAY")
      },
      set: async () => {},
      delete: async () => false,
    }
    const api = "https://api.omo.dev"
    const store = createCredentialStore(api, {
      secrets: noSecretService,
      platform: "linux",
      lockProbe: async () => "unknown",
      home,
    })
    const lines: string[] = []
    const exitCode = await runAccountVerb(
      {
        api,
        store,
        home,
        pinDir: () => join(home, "pins"),
        readStdin: async () => "",
        output: (line) => lines.push(line),
        error: () => {},
      },
      ["show"],
    )
    const { code, out } = await run(["bootstrap", "--json"], owner.stateDir, { exitCode, stdout: lines.join("\n") })
    expect(code).toBe(REMOTE_EXIT.unavailable)
    expect(JSON.parse(out.join(""))).toMatchObject({ state: "store_unavailable" })
    expect(owner.state.log).toEqual([])
  })
})

// This build's own install (deviceServiceBootstrapSetup) against a local release endpoint: no network, a signing key
// made at run time. Each path either installs the pinned release or stops before anything is written or run.
describe("omo remote bootstrap: this build's install", () => {
  const HOST = "linux-x64"
  const VERIFY_FAILED =
    "The downloaded OmO device service failed verification and was not installed. Try again later; if it keeps failing, report it with /bug."

  async function bootstrapWith(release: NonNullable<Parameters<typeof deviceServiceBootstrapSetup>[0]["release"]>) {
    const stateDir = join(privateDir(), "device-service")
    const runs: (readonly string[])[] = []
    const setup = deviceServiceBootstrapSetup({
      stateDir,
      binaryPath: OMO_BINARY,
      agentDir: AGENT_DIR,
      platform: "linux",
      arch: "x64",
      release: {
        origin: RELEASE_ORIGIN,
        // The service's own installer starts the service; here a fake owner stands in for it.
        run: async (argv) => {
          runs.push(argv)
          owners.push(await startFakeOwner({ stateDir, world: defaultWorld() }))
          return { exitCode: 0, output: "" }
        },
        ...release,
      },
    })
    const { code, out } = await run(["bootstrap", "--json"], stateDir, SIGNED_IN, setup)
    return { code, result: JSON.parse(out.join("")) as Record<string, unknown>, runs, stateDir }
  }

  test("a release signed by a key in the set installs the pinned version, runs its installer and connects", async () => {
    const key = releaseKey()
    const served = serveRelease(
      buildRelease({ key, host: HOST, version: DEVICE_SERVICE_VERSION }),
      DEVICE_SERVICE_VERSION,
    )
    const { code, result, runs, stateDir } = await bootstrapWith({ releaseKeys: [key.publicHex], fetch: served.fetch })
    expect([code, result.state]).toEqual([REMOTE_EXIT.ok, "connected"])
    const releaseDir = join(stateDir, "bin", DEVICE_SERVICE_VERSION)
    expect(runs).toEqual([[join(releaseDir, deviceServiceAssetName(HOST)), "install-service", "--from", releaseDir]])
    expect(existsSync(join(releaseDir, deviceServiceAssetName(HOST)))).toBe(true)
  })

  test("this build's pinned keys refuse a release signed by any other key, writing and running nothing", async () => {
    const served = serveRelease(
      buildRelease({ key: releaseKey(), host: HOST, version: DEVICE_SERVICE_VERSION }),
      DEVICE_SERVICE_VERSION,
    )
    const { code, result, runs, stateDir } = await bootstrapWith({ fetch: served.fetch })
    expect([code, result]).toEqual([REMOTE_EXIT.unavailable, { state: "service_degraded", notice: VERIFY_FAILED }])
    expect(served.requested.length).toBeGreaterThan(0)
    // #12580 item 3: the whole bin/ directory, not only bin/<version>: a staging dir left behind is a write too.
    expect([runs, existsSync(join(stateDir, "bin"))]).toEqual([[], false])
  })

  test("a manifest the signed checksums do not cover is refused, writing and running nothing", async () => {
    const key = releaseKey()
    const files = buildRelease({ key, host: HOST, version: DEVICE_SERVICE_VERSION })
    files.set(
      "latest.json",
      new TextEncoder().encode(JSON.stringify({ version: DEVICE_SERVICE_VERSION, min_engine_version: "0.1.0" })),
    )
    const served = serveRelease(files, DEVICE_SERVICE_VERSION)
    const { code, result, runs, stateDir } = await bootstrapWith({ releaseKeys: [key.publicHex], fetch: served.fetch })
    expect([code, result]).toEqual([REMOTE_EXIT.unavailable, { state: "service_degraded", notice: VERIFY_FAILED }])
    expect([runs, existsSync(join(stateDir, "bin"))]).toEqual([[], false])
  })

  test("a release that needs a newer engine than this build bundles stops with update_required, writing nothing", async () => {
    const key = releaseKey()
    // Above any engine this build can bundle.
    const minEngine = "9999.0.0"
    const served = serveRelease(
      buildRelease({ key, host: HOST, version: DEVICE_SERVICE_VERSION, minEngine }),
      DEVICE_SERVICE_VERSION,
    )
    const { code, result, runs, stateDir } = await bootstrapWith({ releaseKeys: [key.publicHex], fetch: served.fetch })
    expect([code, result]).toEqual([
      REMOTE_EXIT.unavailable,
      {
        state: "update_required",
        notice: `This OmO device service needs engine ${minEngine} or later. Update OmO, then try again.`,
      },
    ])
    expect([runs, existsSync(join(stateDir, "bin"))]).toEqual([[], false])
  })

  test("a release endpoint that has never published the pinned version stops as not_published, writing nothing", async () => {
    const served = serveRelease(new Map(), DEVICE_SERVICE_VERSION)
    const { code, result, runs, stateDir } = await bootstrapWith({ fetch: served.fetch })
    expect([code, result]).toEqual([
      REMOTE_EXIT.unavailable,
      {
        state: "not_published",
        notice: `Remote devices are not available in this omo build yet: OmO device service ${DEVICE_SERVICE_VERSION} has not been published.`,
      },
    ])
    expect([runs, existsSync(join(stateDir, "bin"))]).toEqual([[], false])
  })

  test("an unreachable release endpoint stops with the download notice, writing nothing", async () => {
    const requested: string[] = []
    const unreachable = async (url: string): Promise<Response> => {
      requested.push(url)
      throw new TypeError("fetch failed")
    }
    const { code, result, runs, stateDir } = await bootstrapWith({ fetch: unreachable })
    expect([code, result]).toEqual([
      REMOTE_EXIT.unavailable,
      {
        state: "service_degraded",
        notice: "Could not download the OmO device service. Check the connection and try again.",
      },
    ])
    expect(requested[0]).toStartWith(`${RELEASE_ORIGIN}/stable/device-service/${DEVICE_SERVICE_VERSION}/`)
    expect([runs, existsSync(join(stateDir, "bin"))]).toEqual([[], false])
  })
})

describe("omo remote attach", () => {
  async function attach(
    target: readonly string[],
    running = true,
    account = SIGNED_IN,
    connect?: () => ReturnType<typeof connectDeviceService>,
    state?: Status["state"],
  ) {
    const world = defaultWorld()
    const owner = await startFakeOwner({
      stateDir: privateDir(),
      world: state === undefined ? world : { ...world, status: { ...world.status, state } },
    })
    owners.push(owner)
    if (!running) await owner.stop()
    const err: string[] = []
    const prepared = await prepareRemoteAttach(
      {
        accountShow: async () => account,
        stateDir: owner.stateDir,
        connect: connect ?? (() => connectDeviceService({ version: "5.1.52", stateDir: owner.stateDir })),
        now: () => NOW,
        output: () => {},
        write: () => {},
        error: (line) => err.push(line),
      },
      target,
    )
    return { prepared, err }
  }

  test("attaches through the service and hands the engine its attach TUI arguments", async () => {
    const { prepared } = await attach([`${PEER}/${SESSION_ID}`])
    if (typeof prepared === "number") throw new Error(`attach failed with exit ${prepared}`)
    const [flag, socket, sessionFlag, ref, extensions] = prepared.engineArgs
    expect([flag, sessionFlag, ref, extensions]).toEqual(["--attach", "--session", SESSION_ID, "--no-extensions"])
    expect(socket).toMatch(/[\\/]t-[0-9a-f]{16}\.sock$/)
  })

  test.each([[[]], [[`${PEER}/${SESSION_ID}`, "extra"]]])("refuses the target %p as usage", async (target) => {
    const { prepared, err } = await attach(target)
    expect(prepared).toBe(REMOTE_EXIT.usage)
    expect(err[0]).toStartWith("usage: omo remote attach <device>/<session>")
  })

  // An address with an empty side is malformed: usage, as before the address module (#14305 review L2).
  test.each([["/session"], ["device/"]])("refuses the malformed target %p as usage", async (target) => {
    const { prepared, err } = await attach([target])
    expect(prepared).toBe(REMOTE_EXIT.usage)
    expect(err[0]).toStartWith("usage: omo remote attach <device>/<session>")
  })

  // Every omo remote verb needs its device online (#14305): an offline device named by its name is refused at resolution,
  // so no attach reaches the service.
  // (The device_offline code itself is pinned at the resolver seam, remote/device-address.test.ts.)
  test("#given an offline device named by its name #when attach addresses a session on it #then it fails and nothing is attached", async () => {
    const { prepared } = await attach([`Laptop/${SESSION_ID}`])
    expect(prepared).toBe(REMOTE_EXIT.failed)
    expect(owners.at(-1)?.state.log).not.toContain("session.attach")
  })

  // The refusal's candidate lines, by return value: an offline device is the one device the person named, so no
  // choices print (#14440); an ambiguous refusal lists what a person can type back.
  test("#given a device_offline refusal with candidates in its details #when candidateLines reads it #then it answers no lines, and the ambiguous refusal's candidates", () => {
    expect(
      candidateLines({
        code: "device_offline",
        details: { device: "dev-cccccc", candidates: [{ device: "dev-cccccc", name: "Attic", online: false }] },
      }),
    ).toEqual([])
    expect(
      candidateLines({
        code: "ambiguous_target",
        details: {
          candidates: [
            { address: "dev-aaaaaa/0aa1", device: "dev-aaaaaa", device_name: "Studio" },
            { address: "dev-bbbbbb/0aa2", device: "dev-bbbbbb", device_name: "Lab" },
            { device: "dev-noaddr" },
          ],
        },
      }),
    ).toEqual(["  dev-aaaaaa/0aa1  Studio", "  dev-bbbbbb/0aa2  Lab", "  dev-noaddr"])
  })

  // #14305 delta review H1: attach needs the relay like every verb: a service that is off, signed out or not set up
  // names its state, as before the address module, and nothing is attached.
  test.each(["disabled", "signed_out", "not_configured", "sign_in_required"] as const)(
    "#given a device service in state %s #when attach runs #then it names that state and nothing is attached",
    async (state) => {
      const { prepared, err } = await attach([`${PEER}/${SESSION_ID}`], true, SIGNED_IN, undefined, state)
      expect(prepared).toBe(REMOTE_EXIT.failed)
      expect(err[0] ?? "").toContain(`(${state})`)
      expect(owners.at(-1)?.state.log).not.toContain("session.attach")
    },
  )

  test("checks omo account show before it looks for the service", async () => {
    const { prepared, err } = await attach([`${PEER}/${SESSION_ID}`], true, {
      exitCode: 4,
      stdout: '{"signedIn":false}',
    })
    expect([prepared, err]).toEqual([
      REMOTE_EXIT.unavailable,
      ["Sign in to OmO first: run omo login (or sign in from the OmO desktop app)."],
    ])
  })

  test("names a stopped service and an unknown session without a stack", async () => {
    const stopped = await attach([`${PEER}/${SESSION_ID}`], false)
    expect([stopped.prepared, stopped.err]).toEqual([
      REMOTE_EXIT.unavailable,
      ["The OmO device service is not running on this device."],
    ])
    const unknown = await attach([`${PEER}/bm8tc3VjaC1zZXNzaW9u`])
    expect(unknown.prepared).toBe(REMOTE_EXIT.failed)
    expect(unknown.err[0]).toStartWith("omo remote: ")
  })

  // A stopped service on Windows keeps its TCP endpoint file, so the stop shows up as a refused connection.
  test.each(["ECONNREFUSED", "ECONNRESET", "ENOENT"])(
    "names a stopped service when the endpoint remains but the connection fails with %s",
    async (code) => {
      const refused = () => Promise.reject(Object.assign(new Error(`connect ${code} 127.0.0.1:1`), { code }))
      const { prepared, err } = await attach([`${PEER}/${SESSION_ID}`], true, SIGNED_IN, refused)
      expect([prepared, err]).toEqual([
        REMOTE_EXIT.unavailable,
        ["The OmO device service is not running on this device."],
      ])
    },
  )
})

describe("ago", () => {
  test.each([
    [null, "never"],
    [NOW - 10_000, "just now"],
    [NOW - 5 * 60_000, "5m ago"],
    [NOW - 3 * 3_600_000, "3h ago"],
    [NOW - 3 * 86_400_000, "3d ago"],
  ])("%p -> %p", (ms, label) => {
    expect(ago(ms, NOW)).toBe(label)
  })
})
