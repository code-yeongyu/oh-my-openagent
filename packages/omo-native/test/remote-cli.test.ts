import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { connectDeviceService, DEVICE_SERVICE_VERSION } from "../../device-service-core/src/index.ts"
import { deviceServiceAssetName } from "../../device-service-core/src/release/acquire.ts"
import { startFakeOwner, type FakeOwner } from "../../device-service-core/test/local-api/conformance/fake-owner.ts"
import { buildRelease, RELEASE_ORIGIN, releaseKey, serveRelease } from "../../device-service-core/test/release-fixture.ts"
import { defaultWorld, OFFLINE_PEER, PEER, SESSION_ID } from "../../device-service-core/test/local-api/conformance/world.ts"
import { createCredentialStore } from "../../omo-opencode/src/cli/service-auth/keystore"
import type { RemoteSessionsPort, RemoteThreadSurface } from "../../omo-senpi/src/components/thread/remote/ports"
import { createRemoteThreadFixture, ENGINE } from "../../omo-senpi/src/components/thread/thread-remote-fixture"
import { runAccountVerb } from "../account-cli"
import { type BootstrapSetup, deviceServiceBootstrapSetup } from "../remote-bootstrap"
import { prepareRemoteAttach, REMOTE_EXIT, runRemoteVerb } from "../remote-cli"
import { ago } from "../remote-render"

const NOW = 1_790_000_400_000
const owners: FakeOwner[] = []
const dirs: string[] = []

afterEach(async () => {
  for (const owner of owners.splice(0)) await owner.stop()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const privateDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "rcli-"))
  chmodSync(dir, 0o700)
  dirs.push(dir)
  return dir
}

const SIGNED_IN = { exitCode: 0, stdout: JSON.stringify({ signedIn: true, device: { id: "dev-self", name: "This Mac" }, refreshState: "ok" }) }

const AGENT_DIR = "/home/user/.omo/agent"
const OMO_BINARY = "/opt/omo/bin/omo"

// The fake owner serves service_version 1.4.0, so pinning 1.4.0 makes a running owner current.
const testBootstrap = (overrides: Partial<BootstrapSetup> = {}): BootstrapSetup => ({
  pinVersion: "1.4.0",
  install: async () => ({ ok: false, state: "service_degraded", action: "This test installs nothing." }),
  refresher: { binaryPath: OMO_BINARY, version: "5.1.58" },
  agentDir: AGENT_DIR,
  ...overrides,
})

async function run(args: readonly string[], stateDir?: string, account = SIGNED_IN, bootstrap = testBootstrap(), remote?: RemoteThreadSurface) {
  let dir = stateDir
  if (dir === undefined) {
    const owner = await startFakeOwner({ stateDir: privateDir(), world: defaultWorld() })
    owners.push(owner)
    dir = owner.stateDir
  }
  const out: string[] = []
  const err: string[] = []
  const written: string[] = []
  const target = dir
  const code = await runRemoteVerb(
    {
      accountShow: async () => account,
      stateDir: target,
      connect: () => connectDeviceService({ version: "5.1.52", stateDir: target }),
      now: () => NOW,
      output: line => out.push(line),
      write: text => written.push(text),
      error: line => err.push(line),
      bootstrap,
      ...(remote === undefined ? {} : { remote: () => remote }),
    },
    args,
  )
  return { code, out, err, written }
}

describe("omo remote", () => {
  test("status prints the connection state, and --json prints the service's Status", async () => {
    const human = await run(["status"])
    expect(human.code).toBe(REMOTE_EXIT.ok)
    expect(human.out).toContain("State            Connected")
    expect(human.out).toContain("This device      This Mac")
    const json = await run(["status", "--json"])
    expect(JSON.parse(json.out.join(""))).toEqual(defaultWorld().status)
  })

  test("devices lists each device with its presence", async () => {
    const { code, out } = await run(["devices"])
    expect(code).toBe(REMOTE_EXIT.ok)
    expect(out[0]).toMatch(/^DEVICE\s+NAME\s+KIND\s+PLATFORM\s+SEEN$/)
    expect(out[1]).toMatch(new RegExp(`^${PEER}\\s+Studio\\s+desktop\\s+darwin\\s+online$`))
    expect(out[2]).toMatch(new RegExp(`^${OFFLINE_PEER}\\s+Laptop\\s+cli\\s+linux\\s+12d ago$`))
    const json = await run(["devices", "--json"])
    expect(JSON.parse(json.out.join(""))).toEqual(defaultWorld().devices)
  })

  test("sessions shows attach targets, marks cached rows and names devices that did not answer", async () => {
    const { code, out } = await run(["sessions"])
    expect(code).toBe(REMOTE_EXIT.ok)
    const live = out.find(line => line.startsWith(`${PEER}/${SESSION_ID}`))
    expect(live).toMatch(/Live session\s+running\s+omo\s+Studio/)
    expect(out.find(line => line.startsWith(`${OFFLINE_PEER}/${SESSION_ID}`))).toMatch(/running \(cached\)/)
    expect(out.at(-1)).toBe("Not answered, rows may be missing or cached: Laptop")
  })

  test("sessions passes its filter to the service and --json prints the listing result", async () => {
    const { out } = await run(["sessions", "--device", PEER, "--json"])
    const result = JSON.parse(out.join("")) as { rows: { device: string }[] }
    expect(result.rows.map(row => row.device)).toEqual([PEER])
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
    const owner = await startFakeOwner({ stateDir: privateDir(), world: defaultWorld(), capabilities: ["sessions", "devices", "enforcement", "upgrade"] })
    owners.push(owner)
    const { code, err } = await run(["control", "off"], owner.stateDir)
    expect(code).toBe(REMOTE_EXIT.unavailable)
    expect(err).toEqual(["The OmO device service on this device does not have remote control yet. Update OmO, then try again."])
    expect(owner.state.log).not.toContain("control.attach.set")
  })

  test("reports a missing or stopped service without a stack", async () => {
    const missing = await run(["status"], join(privateDir(), "absent"))
    expect(missing.code).toBe(REMOTE_EXIT.unavailable)
    expect(missing.err).toEqual(["The OmO device service is not set up on this device. Install the OmO desktop app to set it up."])
    const stopped = await run(["status"], privateDir())
    expect(stopped.code).toBe(REMOTE_EXIT.unavailable)
    expect(stopped.err).toEqual(["The OmO device service is not running on this device."])
  })
})

describe("omo remote bootstrap: omo account show first", () => {
  test.each([
    ["signed out", { exitCode: 0, stdout: '{"signedIn":false}' }, "Sign in to OmO first: run omo login (or sign in from the OmO desktop app)."],
    ["signed out after omo logout", { exitCode: 0, stdout: '{"signedIn":false,"signedOut":{"at":"2026-10-30T00:00:00.000Z"}}' }, "Sign in to OmO first: run omo login (or sign in from the OmO desktop app)."],
    ["a locked keychain (exit 7)", { exitCode: 7, stdout: '{"keychain":"locked"}' }, "Your OmO sign-in is behind a locked keychain. Unlock it, then try again."],
    ["an unavailable store (exit 9)", { exitCode: 9, stdout: '{"error":"store-unavailable"}' }, "The credential store holding your OmO sign-in is not available right now. Try again in a moment."],
    ["output that is not JSON", { exitCode: 0, stdout: "garbage" }, "Could not read your OmO sign-in (omo account show printed no JSON). Sign in again with omo login."],
    ["signedIn true with a failing exit", { exitCode: 1, stdout: '{"signedIn":true,"device":{"id":"d","name":"n"}}' }, "Could not read your OmO sign-in (omo account show answered an unexpected shape (exit 1)). Sign in again with omo login."],
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
    const { code, out } = await run(["bootstrap", "--json"], owner.stateDir, { exitCode: 4, stdout: '{"signedIn":false}' })
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
    const store = createCredentialStore(api, { secrets: noSecretService, platform: "linux", lockProbe: async () => "unknown", home })
    const lines: string[] = []
    const exitCode = await runAccountVerb(
      { api, store, home, pinDir: () => join(home, "pins"), readStdin: async () => "", output: line => lines.push(line), error: () => {} },
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
        run: async argv => {
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
    const served = serveRelease(buildRelease({ key, host: HOST, version: DEVICE_SERVICE_VERSION }), DEVICE_SERVICE_VERSION)
    const { code, result, runs, stateDir } = await bootstrapWith({ releaseKeys: [key.publicHex], fetch: served.fetch })
    expect([code, result.state]).toEqual([REMOTE_EXIT.ok, "connected"])
    const releaseDir = join(stateDir, "bin", DEVICE_SERVICE_VERSION)
    expect(runs).toEqual([[join(releaseDir, deviceServiceAssetName(HOST)), "install-service", "--from", releaseDir]])
    expect(existsSync(join(releaseDir, deviceServiceAssetName(HOST)))).toBe(true)
  })

  test("this build's pinned keys refuse a release signed by any other key, writing and running nothing", async () => {
    const served = serveRelease(buildRelease({ key: releaseKey(), host: HOST, version: DEVICE_SERVICE_VERSION }), DEVICE_SERVICE_VERSION)
    const { code, result, runs, stateDir } = await bootstrapWith({ fetch: served.fetch })
    expect([code, result]).toEqual([REMOTE_EXIT.unavailable, { state: "service_degraded", notice: VERIFY_FAILED }])
    expect(served.requested.length).toBeGreaterThan(0)
    // #12580 item 3: the whole bin/ directory, not only bin/<version>: a staging dir left behind is a write too.
    expect([runs, existsSync(join(stateDir, "bin"))]).toEqual([[], false])
  })

  test("a manifest the signed checksums do not cover is refused, writing and running nothing", async () => {
    const key = releaseKey()
    const files = buildRelease({ key, host: HOST, version: DEVICE_SERVICE_VERSION })
    files.set("latest.json", new TextEncoder().encode(JSON.stringify({ version: DEVICE_SERVICE_VERSION, min_engine_version: "0.1.0" })))
    const served = serveRelease(files, DEVICE_SERVICE_VERSION)
    const { code, result, runs, stateDir } = await bootstrapWith({ releaseKeys: [key.publicHex], fetch: served.fetch })
    expect([code, result]).toEqual([REMOTE_EXIT.unavailable, { state: "service_degraded", notice: VERIFY_FAILED }])
    expect([runs, existsSync(join(stateDir, "bin"))]).toEqual([[], false])
  })

  test("a release that needs a newer engine than this build bundles stops with update_required, writing nothing", async () => {
    const key = releaseKey()
    // Above any engine this build can bundle.
    const minEngine = "9999.0.0"
    const served = serveRelease(buildRelease({ key, host: HOST, version: DEVICE_SERVICE_VERSION, minEngine }), DEVICE_SERVICE_VERSION)
    const { code, result, runs, stateDir } = await bootstrapWith({ releaseKeys: [key.publicHex], fetch: served.fetch })
    expect([code, result]).toEqual([
      REMOTE_EXIT.unavailable,
      { state: "update_required", notice: `This OmO device service needs engine ${minEngine} or later. Update OmO, then try again.` },
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
      { state: "service_degraded", notice: "Could not download the OmO device service. Check the connection and try again." },
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
  ) {
    const owner = await startFakeOwner({ stateDir: privateDir(), world: defaultWorld() })
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
        error: line => err.push(line),
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

  test.each([[[]], [["no-slash"]], [["/session"]], [["device/"]], [[`${PEER}/${SESSION_ID}`, "extra"]]])(
    "refuses the target %p as usage",
    async target => {
      const { prepared, err } = await attach(target)
      expect(prepared).toBe(REMOTE_EXIT.usage)
      expect(err[0]).toStartWith("usage: omo remote attach <device>/<session>")
    },
  )

  test("checks omo account show before it looks for the service", async () => {
    const { prepared, err } = await attach([`${PEER}/${SESSION_ID}`], true, { exitCode: 4, stdout: '{"signedIn":false}' })
    expect([prepared, err]).toEqual([REMOTE_EXIT.unavailable, ["Sign in to OmO first: run omo login (or sign in from the OmO desktop app)."]])
  })

  test("names a stopped service and an unknown session without a stack", async () => {
    const stopped = await attach([`${PEER}/${SESSION_ID}`], false)
    expect([stopped.prepared, stopped.err]).toEqual([REMOTE_EXIT.unavailable, ["The OmO device service is not running on this device."]])
    const unknown = await attach([`${PEER}/bm8tc3VjaC1zZXNzaW9u`])
    expect(unknown.prepared).toBe(REMOTE_EXIT.failed)
    expect(unknown.err[0]).toStartWith("omo remote: ")
  })

  // A stopped service on Windows keeps its TCP endpoint file, so the stop shows up as a refused connection.
  test.each(["ECONNREFUSED", "ECONNRESET", "ENOENT"])("names a stopped service when the endpoint remains but the connection fails with %s", async code => {
    const refused = () => Promise.reject(Object.assign(new Error(`connect ${code} 127.0.0.1:1`), { code }))
    const { prepared, err } = await attach([`${PEER}/${SESSION_ID}`], true, SIGNED_IN, refused)
    expect([prepared, err]).toEqual([REMOTE_EXIT.unavailable, ["The OmO device service is not running on this device."]])
  })
})

// The session verbs are the thread tools' remote ops (omo-senpi thread/remote), driven here over that suite's fake account.
describe("omo remote session verbs", () => {
  const fixture = createRemoteThreadFixture()
  afterEach(fixture.cleanup)
  const types = <Entry extends { readonly rpc?: Record<string, unknown> }>(sent: readonly Entry[], type: string) => sent.filter(entry => entry.rpc?.["type"] === type)
  // Every call a verb makes on the account surface, in order: a command names its engine record.
  const recorded = (remote: RemoteThreadSurface) => {
    const calls: string[] = []
    const port = remote.sessions
    const note = <T>(call: string, result: Promise<T>): Promise<T> => {
      calls.push(call)
      return result
    }
    const sessions: RemoteSessionsPort = {
      status: () => note("status", port.status()),
      thisDevice: () => note("thisDevice", port.thisDevice()),
      devices: () => note("devices", port.devices()),
      sessions: () => note("sessions", port.sessions()),
      endpointCommand: (device, rpc, options) => note(`endpoint:${String(rpc["type"])}`, port.endpointCommand(device, rpc, options)),
      locate: (device, engineId, knownKey) => note("locate", port.locate(device, engineId, knownKey)),
      sessionCommand: (device, sessionId, rpc, options) => note(`command:${String(rpc["type"])}`, port.sessionCommand(device, sessionId, rpc, options)),
      read: (device, sessionId, tail) => note("read", port.read(device, sessionId, tail)),
      watch: (device, sessionId, listener) => note("watch", port.watch(device, sessionId, listener)),
    }
    return { calls, remote: { ...remote, sessions } }
  }

  test("open creates a session on the device in the project and prints <device>/<session>", async () => {
    const a = fixture.account()
    const { code, out } = await run(["open", "b", "--project", "/work/b"], undefined, SIGNED_IN, testBootstrap(), a.remote)
    expect([code, out]).toEqual([REMOTE_EXIT.ok, ["b/dur-new-on-b"]])
    expect(types(a.sent, "open_session").map(entry => entry.rpc?.["cwd"])).toEqual(["/work/b"])
  })

  test("open --model sets the new session's model, and --json prints the typed result with it", async () => {
    const a = fixture.account()
    const { code, out } = await run(["open", "b", "--model", "openai/gpt-6", "--json"], undefined, SIGNED_IN, testBootstrap(), a.remote)
    expect(code).toBe(REMOTE_EXIT.ok)
    expect(JSON.parse(out.join(""))).toMatchObject({ kind: "ok", thread: { thread_id: "dur-new-on-b", device: "b" }, model: { provider: "openai", id: "gpt-6" } })
    expect(types(a.sent, "set_model").map(entry => [entry.session, entry.rpc?.["modelId"]])).toEqual([["dur-new-on-b", "gpt-6"]])
  })

  test("send streams the answer's text deltas in order and returns once the turn settles", async () => {
    const delta = (text: string) => ({ type: "message_update", message: null, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: text } })
    const a = fixture.account({ records: [{ type: "agent_start" }, delta("O"), { type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "hm" } }, delta("K"), { type: "agent_end" }, { type: "agent_settled" }] })
    const { code, written } = await run(["send", "b/dur-on-b", "Reply with exactly: OK"], undefined, SIGNED_IN, testBootstrap(), a.remote)
    expect([code, written]).toEqual([REMOTE_EXIT.ok, ["O", "K", "\n"]])
    expect(types(a.sent, "prompt").map(entry => entry.rpc?.["message"])).toEqual(["Reply with exactly: OK"])
    expect(a.sent.findIndex(entry => entry.via === "watch")).toBeLessThan(a.sent.findIndex(entry => entry.rpc?.["type"] === "prompt"))
  })

  test("open --model that the new session cannot use names the session it opened, which is still open, in human and --json output", async () => {
    const human = await run(["open", "b", "--model", "nope/none"], undefined, SIGNED_IN, testBootstrap(), fixture.account().remote)
    expect([human.code, human.out]).toEqual([REMOTE_EXIT.failed, ["b/dur-new-on-b"]])
    expect(human.err[0]).toStartWith("omo remote: opened b/dur-new-on-b, but its model was not set: ")
    expect(human.err[1]).toEndWith("The session is still open; end it with omo remote close b/dur-new-on-b.")
    const json = await run(["open", "b", "--model", "nope/none", "--json"], undefined, SIGNED_IN, testBootstrap(), fixture.account().remote)
    expect(json.code).toBe(REMOTE_EXIT.failed)
    expect(JSON.parse(json.out.join(""))).toMatchObject({ kind: "error", error: { code: "model_not_found" }, thread: { thread_id: "dur-new-on-b", device: "b" } })
  })

  test("send whose session closes before its turn finishes fails, though senpi settles that turn", async () => {
    const a = fixture.account({ records: [{ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "O" } }, { type: "agent_settled", reason: "session_closed" }] })
    const { code, err } = await run(["send", "b/dur-on-b", "hi"], undefined, SIGNED_IN, testBootstrap(), a.remote)
    expect([code, err]).toEqual([REMOTE_EXIT.failed, ["omo remote: the session on b ended before its turn settled (session_closed)."]])
  })

  test("send to a session that cannot be followed is refused before the message is sent", async () => {
    const a = fixture.account({ refuse: "host_not_answering" })
    const { code, err } = await run(["send", "b/dur-on-b", "hi"], undefined, SIGNED_IN, testBootstrap(), a.remote)
    expect([code, err[0]]).toEqual([REMOTE_EXIT.failed, "omo remote: Device b did not answer (host_not_answering); this call changed nothing there."])
    expect(types(a.sent, "prompt")).toEqual([])
  })

  test("send puts a line break between the text of two content blocks of one message", async () => {
    const delta = (index: number, text: string) => ({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: index, delta: text } })
    const a = fixture.account({ records: [delta(0, "first"), delta(1, "second"), { type: "agent_settled" }] })
    const { code, written } = await run(["send", "b/dur-on-b", "hi"], undefined, SIGNED_IN, testBootstrap(), a.remote)
    expect([code, written.join("")]).toEqual([REMOTE_EXIT.ok, "first\nsecond\n"])
  })

  test("send puts a line break between the text of two messages, so they never run together", async () => {
    const delta = (text: string) => ({ type: "message_update", message: null, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: text } })
    const a = fixture.account({ records: [delta("OK"), { type: "message_end" }, { type: "message_start" }, delta("Done."), { type: "agent_settled" }] })
    const { code, written } = await run(["send", "b/dur-on-b", "hi"], undefined, SIGNED_IN, testBootstrap(), a.remote)
    expect([code, written.join("")]).toEqual([REMOTE_EXIT.ok, "OK\nDone.\n"])
  })

  test("send --steer steers the running turn, which the engine checks again", async () => {
    const a = fixture.account({ engine: { ...ENGINE, streaming: true, currentTurnId: "3" } })
    const { code, out } = await run(["send", "b/dur-on-b", "faster", "--steer", "--no-wait"], undefined, SIGNED_IN, testBootstrap(), a.remote)
    expect([code, out]).toEqual([REMOTE_EXIT.ok, ["Steered turn 3 on b/dur-on-b."]])
    expect(types(a.sent, "prompt").map(entry => [entry.rpc?.["streamingBehavior"], entry.rpc?.["expectedTurnId"]])).toEqual([["steer", "3"]])
  })

  test("send --follow-up queues behind the running turn", async () => {
    const a = fixture.account({ engine: { ...ENGINE, streaming: true, pending: 2 } })
    const { code, out } = await run(["send", "b/dur-on-b", "later", "--follow-up", "--no-wait"], undefined, SIGNED_IN, testBootstrap(), a.remote)
    expect([code, out]).toEqual([REMOTE_EXIT.ok, ["Queued on b/dur-on-b at position 2."]])
    expect(types(a.sent, "prompt").map(entry => entry.rpc?.["streamingBehavior"])).toEqual(["followUp"])
  })

  // A verb costs its remote op's round trips and nothing account-wide: the session is addressed directly, never looked
  // up in the account listing, whose round waits for the account's slowest device (#12709: ~10 s live).
  test.each([
    [["model", "b/dur-on-b", "anthropic/claude-opus"], "b/dur-on-b now uses anthropic/claude-opus.", ["status", "devices", "command:get_available_models", "command:set_model"]],
    [["interrupt", "b/dur-on-b"], "Nothing was running on b/dur-on-b.", ["status", "devices", "command:interrupt"]],
    [["close", "b/dur-on-b"], "Closed b/dur-on-b.", ["status", "devices", "command:unload_session"]],
    [["send", "b/dur-on-b", "hi", "--no-wait"], "Sent to b/dur-on-b: turn turn-b started.", ["status", "devices", "command:prompt"]],
    [["open", "b"], "b/dur-new-on-b", ["status", "devices", "endpoint:open_session", "locate"]],
  ])("%p makes only its remote op's calls and reports the answer", async (args, line, calls) => {
    const port = recorded(fixture.account().remote)
    const { code, out } = await run(args, undefined, SIGNED_IN, testBootstrap(), port.remote)
    expect([code, out, port.calls]).toEqual([REMOTE_EXIT.ok, [line], calls])
  })

  test("--json prints the remote op's typed result as is", async () => {
    const a = fixture.account({ engine: { ...ENGINE, interrupt: { turnId: "turn-b", interrupted: true } } })
    const { out } = await run(["interrupt", "b/dur-on-b", "--json"], undefined, SIGNED_IN, testBootstrap(), a.remote)
    expect(JSON.parse(out.join(""))).toEqual({ kind: "ok", thread_id: "dur-on-b", turn_id: "turn-b", interrupted: true, device: "b" })
  })

  test.each([
    [["send", "no-slash", "hi"], "omo remote send: name the session as <device>/<session> (the SESSION column of omo remote sessions)"],
    [["send", "b/dur-on-b"], "omo remote send: the message text is required"],
    [["send", "b/dur-on-b", "hi", "--steer", "--follow-up"], "omo remote send: pass --steer or --follow-up, not both"],
    [["model", "b/dur-on-b"], "omo remote model: the model is required (provider/id)"],
    [["open"], "omo remote open: the device is required (the DEVICE column of omo remote devices)"],
    [["open", "b", "--project"], "omo remote open: --project needs a value"],
    [["close", "b/dur-on-b", "--steer"], "omo remote close: unknown argument --steer"],
  ])("refuses %p as usage before contacting the service", async (args, message) => {
    const { code, err } = await run(args, join(privateDir(), "absent"))
    expect(code).toBe(REMOTE_EXIT.usage)
    expect(err[0]).toBe(message)
  })

  // A send is one round trip (#12320): the prompt is the first frame, and the device that does not hold the session
  // refuses it, so the message reaches no session and nothing else is sent.
  test("a session its device does not hold is named as unknown from the device's refusal of the one prompt, and nothing else is sent to it", async () => {
    const a = fixture.account()
    const { code, err } = await run(["send", "b/dur-unknown", "hi"], undefined, SIGNED_IN, testBootstrap(), a.remote)
    expect([code, err]).toEqual([REMOTE_EXIT.failed, ["omo remote: no session b/dur-unknown on this account.", "Run omo remote sessions to see them."]])
    expect(a.sent.flatMap(entry => entry.rpc === undefined ? [] : [entry.rpc["type"]])).toEqual(["prompt"])
  })

  test("a refusal from the remote op is reported with its next step, and nothing is followed", async () => {
    const a = fixture.account({ online: false })
    const { code, err } = await run(["send", "b/dur-on-b", "hi"], undefined, SIGNED_IN, testBootstrap(), a.remote)
    expect([code, err]).toEqual([REMOTE_EXIT.failed, ["omo remote: Device b is offline.", "Retry when that device is online; nothing was queued."]])
    expect(a.sent).toEqual([])
  })
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
