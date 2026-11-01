import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { connectDeviceService } from "../../device-service-core/src/index.ts"
import { startFakeOwner, type FakeOwner } from "../../device-service-core/test/local-api/conformance/fake-owner.ts"
import { defaultWorld, OFFLINE_PEER, PEER, SESSION_ID } from "../../device-service-core/test/local-api/conformance/world.ts"
import { ago, prepareRemoteAttach, REMOTE_EXIT, runRemoteVerb } from "../remote-cli"

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

async function run(args: readonly string[], stateDir?: string, account = SIGNED_IN) {
  let dir = stateDir
  if (dir === undefined) {
    const owner = await startFakeOwner({ stateDir: privateDir(), world: defaultWorld() })
    owners.push(owner)
    dir = owner.stateDir
  }
  const out: string[] = []
  const err: string[] = []
  const target = dir
  const code = await runRemoteVerb(
    {
      accountShow: async () => account,
      stateDir: target,
      connect: () => connectDeviceService({ version: "5.1.52", stateDir: target }),
      now: () => NOW,
      output: line => out.push(line),
      error: line => err.push(line),
    },
    args,
  )
  return { code, out, err }
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
