import { describe, expect, test } from "bun:test"

import { connectDeviceService } from "../../device-service-core/src/index.ts"
import { startFakeOwner } from "../../device-service-core/test/local-api/conformance/fake-owner.ts"
import { defaultWorld } from "../../device-service-core/test/local-api/conformance/world.ts"
import type { Credentials } from "../../omo-opencode/src/cli/service-auth/protocol"
import { cliDeviceServiceHandoff } from "../device-service-handoff"
import { REMOTE_EXIT } from "../remote-cli"
import type { ColdWake, LocalStatus } from "../remote-cold-wake"
import {
  AGENT_DIR,
  OMO_BINARY,
  owners,
  privateDir,
  run,
  SIGNED_IN,
  signedInCredential,
  testBootstrap,
  useRemoteCliCleanup,
} from "./remote-cli-harness"

useRemoteCliCleanup()

// omo#13594: the cold-wake unit follows the device's remote-sessions switch. It is installed or removed only after the
// verb succeeded and its connection is closed, and a cold wake that fails is a notice, never the verb's outcome.
describe("omo remote and the cold-wake unit", () => {
  test("bootstrap installs it on a device with remote sessions on, after reporting connected", async () => {
    const { code, out, coldWake } = await run(["bootstrap", "--json"])
    expect(code).toBe(REMOTE_EXIT.ok)
    expect(JSON.parse(out.join(""))).toMatchObject({ state: "connected" })
    expect(coldWake).toEqual(["install"])
  })

  test("bootstrap removes it on a device with remote sessions off, so it does not come back", async () => {
    const owner = await startFakeOwner({ stateDir: privateDir(), world: defaultWorld() })
    owners.push(owner)
    expect((await run(["disable"], owner.stateDir)).coldWake).toEqual(["uninstall"])
    expect((await run(["bootstrap", "--json"], owner.stateDir)).coldWake).toEqual(["uninstall"])
    expect((await run(["enable"], owner.stateDir)).coldWake).toEqual(["install"])
  })

  test("a stopped bootstrap or a verb that failed touches nothing", async () => {
    const signedOut = await run(["bootstrap", "--json"], undefined, { exitCode: 4, stdout: '{"signedIn":false}' })
    expect([signedOut.code, signedOut.coldWake]).toEqual([REMOTE_EXIT.unavailable, []])
    const stopped = await run(["enable"], privateDir())
    expect([stopped.code, stopped.coldWake]).toEqual([REMOTE_EXIT.unavailable, []])
    expect((await run(["status"])).coldWake).toEqual([])
  })

  test("a cold wake that fails prints one notice and keeps the verb's exit code and output", async () => {
    const failing: ColdWake = {
      install: async () => ({ kind: "failed", step: "service_restart", detail: "Failed to restart" }),
      uninstall: async () => ({ kind: "removed", serviceRestarted: false }),
      status: async () => undefined,
    }
    const { code, out, err } = await run(["enable", "--json"], undefined, SIGNED_IN, testBootstrap(), undefined, {
      coldWake: failing,
    })
    expect(code).toBe(REMOTE_EXIT.ok)
    expect(JSON.parse(out.join(""))).toEqual({ enabled: true })
    expect(err).toHaveLength(1)
  })
})

// omo#13594: `omo remote enable` is the one command after `omo login`. It runs the bootstrap first, so on a device whose
// service is not running it installs it, it registers this agent dir with the service (no endpoint or delivery consumer
// exists for an agent dir the service does not know), turns remote sessions on and installs the session host unit; run
// again it changes nothing. `omo remote status` reads both units back.
describe("omo remote enable: the one command after sign-in", () => {
  test("installs the service when none runs, registers this agent dir and the refresher, and turns remote sessions on", async () => {
    const stateDir = privateDir()
    let installs = 0
    const bootstrap = testBootstrap({
      install: async () => {
        installs++
        owners.push(await startFakeOwner({ stateDir, world: defaultWorld() }))
        return { ok: true }
      },
    })
    const first = await run(["enable", "--json"], stateDir, SIGNED_IN, bootstrap)
    expect(first.code).toBe(REMOTE_EXIT.ok)
    expect(JSON.parse(first.out.join(""))).toEqual({ enabled: true })
    const owner = owners.at(-1)
    expect([...(owner?.state.endpoints ?? [])]).toEqual([AGENT_DIR])
    expect(owner?.state.refresher).toEqual({ binary_path: OMO_BINARY, version: "5.1.58" })
    expect(first.coldWake).toEqual(["install"])
    const again = await run(["enable", "--json"], stateDir, SIGNED_IN, bootstrap)
    expect([again.code, JSON.parse(again.out.join(""))]).toEqual([REMOTE_EXIT.ok, { enabled: true }])
    expect(installs).toBe(1)
    expect([...(owner?.state.endpoints ?? [])]).toEqual([AGENT_DIR])
  })

  test("stops before anything is installed or registered when signed out", async () => {
    const stateDir = privateDir()
    let installs = 0
    const bootstrap = testBootstrap({ install: async () => (installs++, { ok: true }) })
    const { code, coldWake } = await run(["enable"], stateDir, { exitCode: 4, stdout: '{"signedIn":false}' }, bootstrap)
    expect([code, installs, coldWake]).toEqual([REMOTE_EXIT.unavailable, 0, []])
  })

  test("status --json carries the local units the service manager reports, beside the service's own status", async () => {
    const local: LocalStatus = {
      session_host: { unit: "omo-session-host.service", state: "running", enabled: true, pinned: true },
      device_service: { unit: "omo-relay-daemon.service", state: "running" },
      cold_wake_entry: true,
      agent_dir: AGENT_DIR,
    }
    const coldWake: ColdWake = {
      install: async () => ({ kind: "installed", serviceRestarted: false }),
      uninstall: async () => ({ kind: "removed", serviceRestarted: false }),
      status: async () => local,
    }
    const json = await run(["status", "--json"], undefined, SIGNED_IN, testBootstrap(), undefined, { coldWake })
    expect(JSON.parse(json.out.join(""))).toEqual({ ...defaultWorld().status, service_version: "1.4.0", local })
    const human = await run(["status"], undefined, SIGNED_IN, testBootstrap(), undefined, { coldWake })
    expect(human.out.some((line) => line.startsWith("Session host") && line.includes("pinned"))).toBe(true)
  })
})

// omo#13602 (LEAD ruling B): `omo login` then `omo remote enable` must end connected. A sign-in made before the service
// was installed never reached it, so the explicit enable verb (never the background bootstrap) hands the signed-in
// session's device keys to the service through the same handoff a fresh login uses, and only while it holds no device.
describe("omo remote enable links a sign-in the service has not seen", () => {
  const signedIn: Credentials = signedInCredential()

  async function serviceWithoutDevice(hasDevice: boolean) {
    const world = defaultWorld()
    const status = hasDevice ? world.status : { ...world.status, state: "sign_in_required" as const, device: null }
    const owner = await startFakeOwner({ stateDir: privateDir(), world: { ...world, status } })
    owners.push(owner)
    const reads: string[] = []
    const linkDevice = async () => {
      reads.push("credential")
      await cliDeviceServiceHandoff({
        api: "https://api.example",
        log: () => {},
        stateDir: owner.stateDir,
        connect: () => connectDeviceService({ version: "5.1.52", stateDir: owner.stateDir }),
      }).adopt(signedIn)
      return "linked" as const
    }
    return { owner, reads, linkDevice }
  }

  test("hands the signed-in device to a service that holds none, so the device ends connected", async () => {
    const { owner, reads, linkDevice } = await serviceWithoutDevice(false)
    const { code } = await run(["enable"], owner.stateDir, SIGNED_IN, testBootstrap(), undefined, { linkDevice })
    expect(code).toBe(REMOTE_EXIT.ok)
    expect([reads, owner.state.adoptions, owner.state.status.device?.id]).toEqual([["credential"], 1, "dev-self"])
  })

  test("reads no credential when the service already holds a device", async () => {
    const { owner, reads, linkDevice } = await serviceWithoutDevice(true)
    await run(["enable"], owner.stateDir, SIGNED_IN, testBootstrap(), undefined, { linkDevice })
    expect([reads, owner.state.adoptions]).toEqual([[], 0])
  })

  test("says to sign in when there is no signed-in session to hand over", async () => {
    const { owner } = await serviceWithoutDevice(false)
    const { code, err } = await run(["enable"], owner.stateDir, SIGNED_IN, testBootstrap(), undefined, {
      linkDevice: async () => "signed_out",
    })
    expect([code, err.length, owner.state.adoptions]).toEqual([REMOTE_EXIT.ok, 1, 0])
  })
})
