import { describe, expect, test } from "bun:test"

import { connectDeviceService } from "../../device-service-core/src/index.ts"
import { startFakeOwner } from "../../device-service-core/test/local-api/conformance/fake-owner.ts"
import { defaultWorld } from "../../device-service-core/test/local-api/conformance/world.ts"
import { cliDeviceServiceHandoff } from "../device-service-handoff"
import {
  REMOTE_KEPT_OFF_AFTER_SIGN_IN,
  REMOTE_ON_AFTER_SIGN_IN,
  REMOTE_TURNING_ON_AFTER_SIGN_IN,
  runEnableVerb,
  runLoginSetup,
} from "../remote-bootstrap"
import { disableNotSavedNotice, REMOTE_EXIT } from "../remote-cli"
import { afterServiceAuth } from "../service-auth-command"
import {
  owners,
  privateDir,
  run,
  SIGNED_IN,
  signedInCredential,
  testBootstrap,
  useRemoteCliCleanup,
} from "./remote-cli-harness"

useRemoteCliCleanup()

// omo#13602 (Q: on by default, off with disable): the bootstrap every omo start and every `omo login` run sets a signed-in
// device up exactly as enable does, unless its user recorded an opt-out with disable; enable clears the record.
describe("remote sessions on by default", () => {
  async function device(hasDevice: boolean) {
    const world = defaultWorld()
    const status = hasDevice ? world.status : { ...world.status, state: "sign_in_required" as const, device: null }
    const owner = await startFakeOwner({ stateDir: privateDir(), world: { ...world, status } })
    owners.push(owner)
    const connect = () => connectDeviceService({ version: "5.1.52", stateDir: owner.stateDir })
    const linkDevice = async () => {
      await cliDeviceServiceHandoff({
        api: "https://api.example",
        log: () => {},
        stateDir: owner.stateDir,
        connect,
      }).adopt(signedInCredential())
      return "linked" as const
    }
    const record = { off: false }
    const optOut = {
      read: () => record.off,
      record: () => (record.off = true),
      clear: () => (record.off = false),
    }
    const remote = { linkDevice, optOut }
    return { owner, connect, record, remote }
  }

  test("a fresh sign-in: the bootstrap links the device, so it ends connected, and installs the unit", async () => {
    const { owner, remote } = await device(false)
    const { code, out, coldWake } = await run(
      ["bootstrap", "--json"],
      owner.stateDir,
      SIGNED_IN,
      testBootstrap(),
      undefined,
      remote,
    )
    expect(code).toBe(REMOTE_EXIT.ok)
    expect(owner.state.adoptions).toBe(1)
    expect(JSON.parse(out.join("")).status.device?.id).toBe("dev-self")
    expect(coldWake).toEqual(["install"])
  })

  test("disable records the opt-out, and the next bootstrap keeps everything off even when the switch came back on", async () => {
    const { owner, connect, record, remote } = await device(true)
    const off = await run(["disable"], owner.stateDir, SIGNED_IN, testBootstrap(), undefined, remote)
    expect([off.code, record.off, off.coldWake]).toEqual([REMOTE_EXIT.ok, true, ["uninstall"]])
    // The device service's switch comes back on by itself (a reinstall or a forget resets it to its default).
    const service = await connect()
    await service.setEnabled(true)
    service.close()
    const restart = await run(["bootstrap", "--json"], owner.stateDir, SIGNED_IN, testBootstrap(), undefined, remote)
    expect(JSON.parse(restart.out.join("")).status.enabled).toBe(false)
    expect([owner.state.status.enabled, restart.coldWake, owner.state.adoptions]).toEqual([false, ["uninstall"], 0])
  })

  // #13602 security review M1: the user's off must hold even when disable cannot reach the service right now, or the
  // default-on bootstrap would turn remote back on at the next start.
  test.each([
    ["the device service is not running", SIGNED_IN],
    ["the account is signed out", { exitCode: 4, stdout: '{"signedIn":false}' }],
  ])("disable records the opt-out and removes the unit when %s", async (_why, account) => {
    const record = { off: false }
    const optOut = {
      read: () => record.off,
      record: () => (record.off = true),
      clear: () => (record.off = false),
    }
    const { code, coldWake } = await run(["disable"], privateDir(), account, testBootstrap(), undefined, { optOut })
    expect([code, record.off, coldWake]).toEqual([REMOTE_EXIT.unavailable, true, ["uninstall"]])
  })

  // #13602 security review M2: a record that cannot be saved must not stop disable from turning remote off.
  test("disable still turns the switch off and removes the unit when the opt-out cannot be saved, and says so", async () => {
    const { owner, remote } = await device(true)
    const failing = {
      ...remote.optOut,
      record: () => {
        throw new Error("~/.omo is not writable")
      },
    }
    const { code, err, coldWake } = await run(["disable"], owner.stateDir, SIGNED_IN, testBootstrap(), undefined, {
      ...remote,
      optOut: failing,
    })
    expect([code, owner.state.status.enabled, coldWake]).toEqual([REMOTE_EXIT.failed, false, ["uninstall"]])
    expect(err).toEqual([disableNotSavedNotice("~/.omo is not writable", true)])
  })

  // #13602 security review M3: when the verb itself did not turn remote off (signed out, service not running), the
  // notice must not claim it did.
  test("an unsaved opt-out with a disable that could not reach the service says remote may still be on", async () => {
    const failing = {
      read: () => false,
      record: () => {
        throw new Error("~/.omo is not writable")
      },
      clear: () => {},
    }
    const signedOut = { exitCode: 4, stdout: '{"signedIn":false}' }
    const { code, err } = await run(["disable"], privateDir(), signedOut, testBootstrap(), undefined, {
      optOut: failing,
    })
    expect(code).toBe(REMOTE_EXIT.failed)
    expect(err.at(-1)).toBe(disableNotSavedNotice("~/.omo is not writable", false))
  })

  test("enable after disable clears the opt-out, and the bootstrap keeps it on again", async () => {
    const { owner, record, remote } = await device(true)
    await run(["disable"], owner.stateDir, SIGNED_IN, testBootstrap(), undefined, remote)
    const on = await run(["enable", "--json"], owner.stateDir, SIGNED_IN, testBootstrap(), undefined, remote)
    expect([JSON.parse(on.out.join("")), record.off, on.coldWake]).toEqual([{ enabled: true }, false, ["install"]])
    const restart = await run(["bootstrap", "--json"], owner.stateDir, SIGNED_IN, testBootstrap(), undefined, remote)
    expect([owner.state.status.enabled, restart.coldWake]).toEqual([true, ["install"]])
  })

  test("a bootstrap never turns on a switch that was turned off without an opt-out (the desktop app's toggle)", async () => {
    const { owner, connect, remote } = await device(true)
    const service = await connect()
    await service.setEnabled(false)
    service.close()
    const restart = await run(["bootstrap", "--json"], owner.stateDir, SIGNED_IN, testBootstrap(), undefined, remote)
    expect([owner.state.status.enabled, restart.coldWake]).toEqual([false, ["uninstall"]])
  })
})

describe("omo login sets remote sessions up", () => {
  test("only after a successful login, against the API it signed in to", async () => {
    const calls: string[] = []
    const setUp = async () => void calls.push(process.env.OMO_SERVICE_API_URL ?? "default")
    const saved = process.env.OMO_SERVICE_API_URL
    try {
      delete process.env.OMO_SERVICE_API_URL
      await afterServiceAuth(["logout"], 0, setUp)
      await afterServiceAuth(["login"], 1, setUp)
      await afterServiceAuth(["login", "--device"], 0, setUp)
      await afterServiceAuth(["login", "--api", "https://staging.example"], 0, setUp)
      expect(calls).toEqual(["default", "https://staging.example"])
    } finally {
      if (saved === undefined) delete process.env.OMO_SERVICE_API_URL
      else process.env.OMO_SERVICE_API_URL = saved
    }
  })
})

// omo#13602 (Q: the moment login completes, remote switches on, and login says so): the setup after `omo login` turns the
// switch on like enable does and prints the one line the desktop app also shows; a recorded opt-out keeps it off.
describe("omo login switches remote sessions on and says so", () => {
  async function signedInDeviceWithSwitchOff(optedOut: boolean, switchOn = false) {
    const world = defaultWorld()
    const owner = await startFakeOwner({
      stateDir: privateDir(),
      world: {
        ...world,
        status: { ...world.status, state: "sign_in_required" as const, device: null },
      },
    })
    owners.push(owner)
    const connect = () => connectDeviceService({ version: "5.1.52", stateDir: owner.stateDir })
    const off = await connect()
    await off.setEnabled(switchOn)
    off.close()
    const out: string[] = []
    const coldWake: string[] = []
    const record = { off: optedOut }
    const io = {
      accountShow: async () => SIGNED_IN,
      stateDir: owner.stateDir,
      connect,
      output: (line: string) => out.push(line),
      error: (line: string) => out.push(`stderr: ${line}`),
    }
    const remote = {
      coldWake: {
        install: async () => (coldWake.push("install"), { kind: "installed" as const, serviceRestarted: false }),
        uninstall: async () => (coldWake.push("uninstall"), { kind: "removed" as const, serviceRestarted: false }),
        status: async () => undefined,
      },
      linkDevice: async () => {
        await cliDeviceServiceHandoff({
          api: "https://api.example",
          log: () => {},
          stateDir: owner.stateDir,
          connect,
        }).adopt(signedInCredential())
        return "linked" as const
      },
      optOut: {
        read: () => record.off,
        record: () => (record.off = true),
        clear: () => (record.off = false),
      },
    }
    const backgroundStarts: string[] = []
    const background = (verb: "enable" | "bootstrap") => {
      backgroundStarts.push(verb)
    }
    return { owner, out, coldWake, io, remote, background, backgroundStarts }
  }

  // omo#13722: login never installs the device service itself. With no current service running, the install (download,
  // the platform's permission steps, the service registration) is handed to a detached omo remote enable, so login exits
  // at once on every platform; before, an install that never settled held login until its test timed out on Windows.
  test("a device with no running service: login hands the install to a background enable, prints the line, never waits", async () => {
    const { io, remote, background, backgroundStarts } = await signedInDeviceWithSwitchOff(false)
    const out: string[] = []
    const noService = {
      ...io,
      stateDir: privateDir(),
      connect: () => connectDeviceService({ version: "5.1.52", stateDir: privateDir() }),
      output: (line: string) => out.push(line),
      error: (line: string) => out.push(`stderr: ${line}`),
    }
    const installs: string[] = []
    const setup = {
      ...testBootstrap(),
      install: () => {
        installs.push("install")
        return new Promise<never>(() => {})
      },
    }
    const settled = await Promise.race([
      runLoginSetup(noService, setup, remote, background),
      Bun.sleep(5_000).then(() => "login waited on the install"),
    ])
    expect(settled).toBe("background")
    expect([installs, backgroundStarts, out]).toEqual([[], ["enable"], [REMOTE_TURNING_ON_AFTER_SIGN_IN]])
  })

  // #13724 review M1: an opt-out is enforced at login on any device. With no current service (none, or an older one),
  // the background omo remote bootstrap installs it and turns its switch off; login itself never installs.
  test("a recorded opt-out with no current service: login installs nothing itself and hands it to a background bootstrap", async () => {
    const { io, remote, background, backgroundStarts } = await signedInDeviceWithSwitchOff(true)
    const out: string[] = []
    const noService = {
      ...io,
      stateDir: privateDir(),
      connect: () => connectDeviceService({ version: "5.1.52", stateDir: privateDir() }),
      output: (line: string) => out.push(line),
    }
    const installs: string[] = []
    const setup = {
      ...testBootstrap(),
      install: async () => {
        installs.push("install")
        return { ok: true as const }
      },
    }
    expect(await runLoginSetup(noService, setup, remote, background)).toBe("kept_off")
    expect([installs, backgroundStarts, out]).toEqual([[], ["bootstrap"], [REMOTE_KEPT_OFF_AFTER_SIGN_IN]])
  })

  test("switches the service on, links the device, installs the unit and prints the one line", async () => {
    const { owner, out, coldWake, io, remote, background, backgroundStarts } = await signedInDeviceWithSwitchOff(false)
    expect(await runLoginSetup(io, testBootstrap(), remote, background)).toBe("on")
    expect(out).toEqual([REMOTE_ON_AFTER_SIGN_IN])
    expect([owner.state.status.enabled, owner.state.adoptions, coldWake, backgroundStarts]).toEqual([
      true,
      1,
      ["install"],
      [],
    ])
  })

  test("keeps a recorded opt-out: nothing is switched on, and the line says how to turn it on", async () => {
    const { owner, out, coldWake, io, remote, background, backgroundStarts } = await signedInDeviceWithSwitchOff(true)
    expect(await runLoginSetup(io, testBootstrap(), remote, background)).toBe("kept_off")
    expect(out).toEqual([REMOTE_KEPT_OFF_AFTER_SIGN_IN])
    expect([owner.state.status.enabled, owner.state.adoptions, coldWake, backgroundStarts]).toEqual([
      false,
      0,
      ["uninstall"],
      [],
    ])
  })

  // #13602 security re-review M1: a recorded opt-out is enforced at login, not only at the next omo start. A switch that
  // came back on (a reinstall or a forget resets it) is turned off and the unit removed before the line is printed.
  test("with an opt-out on record, turns a switch that came back on off again and removes the unit", async () => {
    const { owner, out, coldWake, io, remote, background, backgroundStarts } = await signedInDeviceWithSwitchOff(
      true,
      true,
    )
    expect(await runLoginSetup(io, testBootstrap(), remote, background)).toBe("kept_off")
    expect(out).toEqual([REMOTE_KEPT_OFF_AFTER_SIGN_IN])
    expect([owner.state.status.enabled, owner.state.adoptions, coldWake, backgroundStarts]).toEqual([
      false,
      0,
      ["uninstall"],
      [],
    ])
  })
})
