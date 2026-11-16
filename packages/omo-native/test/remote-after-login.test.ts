import { describe, expect, test } from "bun:test"

import { connectDeviceService } from "../../device-service-core/src/index.ts"
import { startFakeOwner } from "../../device-service-core/test/local-api/conformance/fake-owner.ts"
import { defaultWorld } from "../../device-service-core/test/local-api/conformance/world.ts"
import { REMOTE_TURNING_ON_AFTER_SIGN_IN, runLoginSetup } from "../remote-bootstrap"
import { REMOTE_EXIT } from "../remote-cli"
import type { ColdWake } from "../remote-cold-wake"
import { AFTER_LOGIN_FLAG } from "../remote-verbs"
import { owners, privateDir, run, SIGNED_IN, testBootstrap, useRemoteCliCleanup } from "./remote-cli-harness"

useRemoteCliCleanup()

const optOutRecord = (off = false) => {
  const record = { off, clears: 0 }
  const optOut = {
    read: () => record.off,
    record: () => void (record.off = true),
    clear: () => {
      record.clears += 1
      record.off = false
    },
  }
  return { record, optOut }
}

// #13724 review M1: login hands the install to a detached `omo remote enable --after-login`, which can run for minutes
// (Windows). An `omo remote disable` typed meanwhile records the opt-out and finds no service; the background enable must
// honour it once its install is done: the installed service's switch off, the unit removed, the opt-out kept.
describe("the background enable omo login starts", () => {
  // The install brings the service up (its switch on, as a fresh install has it) while the user runs disable.
  const installWithDisableMeanwhile = (stateDir: string, record: { off: boolean }) =>
    testBootstrap({
      install: async () => {
        owners.push(await startFakeOwner({ stateDir, world: defaultWorld() }))
        record.off = true
        return { ok: true }
      },
    })

  test("an opt-out recorded during its install: the switch ends off, the unit removed, the opt-out still recorded", async () => {
    const stateDir = privateDir()
    const { record, optOut } = optOutRecord()
    const { code, out, coldWake } = await run(
      ["enable", AFTER_LOGIN_FLAG, "--json"],
      stateDir,
      SIGNED_IN,
      installWithDisableMeanwhile(stateDir, record),
      undefined,
      { optOut },
    )
    expect([code, out.map((line) => JSON.parse(line)), coldWake]).toEqual([
      REMOTE_EXIT.ok,
      [{ enabled: false }],
      ["uninstall"],
    ])
    expect([owners[0]?.state.status.enabled, record.off, record.clears]).toEqual([false, true, 0])
  })

  // #13762 review L1: a disable that lands right after the enable's re-read (it records the opt-out and switches the
  // service off) and before the enable's switch-on. The hook runs inside that re-read, so the order is fixed, not timed.
  test("a disable between its re-read and its switch-on: the switch ends off, the unit removed, the opt-out kept", async () => {
    const stateDir = privateDir()
    const { record, optOut } = optOutRecord()
    let reads = 0
    const disableAfterFirstRead = {
      ...optOut,
      read: () => {
        const off = optOut.read()
        reads += 1
        if (reads === 1) {
          record.off = true
          const owner = owners[0]
          if (owner !== undefined) owner.state.status = { ...owner.state.status, enabled: false, state: "disabled" }
        }
        return off
      },
    }
    const { code, out, coldWake } = await run(
      ["enable", AFTER_LOGIN_FLAG, "--json"],
      stateDir,
      SIGNED_IN,
      testBootstrap({
        install: async () => {
          owners.push(await startFakeOwner({ stateDir, world: defaultWorld() }))
          return { ok: true }
        },
      }),
      undefined,
      { optOut: disableAfterFirstRead },
    )
    expect([code, out.map((line) => JSON.parse(line)), coldWake]).toEqual([
      REMOTE_EXIT.ok,
      [{ enabled: false }],
      ["uninstall"],
    ])
    expect([owners[0]?.state.status.enabled, record.off, record.clears]).toEqual([false, true, 0])
  })

  // #13762 review LOW: the session host unit is ordered against a late disable as the switch is. The disable (record the
  // opt-out, switch the service off, remove the unit) lands after the enable's second opt-out read, before its unit
  // install or inside it; the hooks run in those steps, so the order is fixed, not timed. A disable before the install
  // means no install call at all (#13784 review L1): an install that is not needed can restart the device service.
  for (const lands of ["before", "during"] as const)
    test(`a disable ${lands} its unit install: the unit ends removed, the switch off, the opt-out kept`, async () => {
      const stateDir = privateDir()
      const { record, optOut } = optOutRecord()
      const unit = { installed: false, installs: 0 }
      const disable = () => {
        record.off = true
        const owner = owners[0]
        if (owner !== undefined) owner.state.status = { ...owner.state.status, enabled: false, state: "disabled" }
        unit.installed = false
      }
      let reads = 0
      const disableAfterSecondRead = {
        ...optOut,
        read: () => {
          const off = optOut.read()
          reads += 1
          if (reads === 2 && lands === "before") disable()
          return off
        },
      }
      const coldWake: ColdWake = {
        install: async () => {
          unit.installs += 1
          if (lands === "during") disable()
          unit.installed = true
          return { kind: "installed", serviceRestarted: false }
        },
        uninstall: async () => {
          unit.installed = false
          return { kind: "removed", serviceRestarted: false }
        },
        status: async () => undefined,
      }
      const { code } = await run(
        ["enable", AFTER_LOGIN_FLAG, "--json"],
        stateDir,
        SIGNED_IN,
        testBootstrap({
          install: async () => {
            owners.push(await startFakeOwner({ stateDir, world: defaultWorld() }))
            return { ok: true }
          },
        }),
        undefined,
        { optOut: disableAfterSecondRead, coldWake },
      )
      expect([code, unit.installed, unit.installs, owners[0]?.state.status.enabled, record.off, record.clears]).toEqual(
        [REMOTE_EXIT.ok, false, lands === "before" ? 0 : 1, false, true, 0],
      )
    })

  // #13724 review L1: with no opt-out recorded there is nothing to clear; a clear here could only erase one a disable
  // recorded after the re-read.
  test("no opt-out recorded: it switches remote on and never clears the opt-out record", async () => {
    const stateDir = privateDir()
    const { record, optOut } = optOutRecord()
    const { code, out, coldWake } = await run(
      ["enable", AFTER_LOGIN_FLAG, "--json"],
      stateDir,
      SIGNED_IN,
      testBootstrap({
        install: async () => {
          owners.push(await startFakeOwner({ stateDir, world: defaultWorld() }))
          return { ok: true }
        },
      }),
      undefined,
      { optOut },
    )
    expect([code, out.map((line) => JSON.parse(line)), coldWake]).toEqual([
      REMOTE_EXIT.ok,
      [{ enabled: true }],
      ["install"],
    ])
    expect([owners[0]?.state.status.enabled, record.off, record.clears]).toEqual([true, false, 0])
  })

  test("a user-typed enable is the user turning remote on: it switches on and clears the opt-out", async () => {
    const stateDir = privateDir()
    const { record, optOut } = optOutRecord()
    const { code, coldWake } = await run(
      ["enable", "--json"],
      stateDir,
      SIGNED_IN,
      installWithDisableMeanwhile(stateDir, record),
      undefined,
      { optOut },
    )
    expect([code, coldWake, owners[0]?.state.status.enabled, record.off]).toEqual([
      REMOTE_EXIT.ok,
      ["install"],
      true,
      false,
    ])
  })
})

// #13724 review L1: a running service older than this build's pin is no current service (connectCurrent closes it and
// reports absent), so login hands the install to the background enable and never installs inline.
test("login with an older device service running: hands off to the background enable, installs nothing itself", async () => {
  const world = defaultWorld()
  const owner = await startFakeOwner({
    stateDir: privateDir(),
    world: { ...world, status: { ...world.status, enabled: false } },
  })
  owners.push(owner)
  const out: string[] = []
  const installs: string[] = []
  const backgroundStarts: string[] = []
  const io = {
    accountShow: async () => SIGNED_IN,
    stateDir: owner.stateDir,
    connect: () => connectDeviceService({ version: "5.1.52", stateDir: owner.stateDir }),
    output: (line: string) => out.push(line),
    error: (line: string) => out.push(`stderr: ${line}`),
  }
  const remote = {
    coldWake: {
      install: async () => ({ kind: "installed" as const, serviceRestarted: false }),
      uninstall: async () => ({ kind: "removed" as const, serviceRestarted: false }),
      status: async () => undefined,
    },
    linkDevice: async () => "linked" as const,
    optOut: optOutRecord().optOut,
  }
  // The fake owner serves 1.4.0; a pin above it makes the running service older than this build's.
  const setup = testBootstrap({
    pinVersion: "9.0.0",
    install: async () => {
      installs.push("install")
      return { ok: true }
    },
  })
  const outcome = await runLoginSetup(io, setup, remote, (verb) => void backgroundStarts.push(verb))
  expect([outcome, installs, backgroundStarts, out]).toEqual([
    "background",
    [],
    ["enable"],
    [REMOTE_TURNING_ON_AFTER_SIGN_IN],
  ])
  expect(owner.state.status.enabled).toBe(false)
})
