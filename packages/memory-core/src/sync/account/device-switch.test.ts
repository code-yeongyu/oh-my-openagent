import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createInMemoryDeviceKeyring } from "../keyring-port.ts"
import { disableSync, isDeviceSyncOff, turnDeviceSyncOn } from "./device-switch.ts"
import type { DeviceSyncOff, PairingHttp } from "./pairing-http.ts"
import { openAccountSession } from "./session.ts"

const ACCOUNT = "acct"
const DEVICE = "dev_svc"

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

const unused = (): never => {
  throw new Error("not used by this case")
}

async function device(off: () => Promise<DeviceSyncOff> = async () => ({ ok: true })) {
  const pinDir = await mkdtemp(join(tmpdir(), "omo-device-switch-"))
  dirs.push(pinDir)
  const calls: string[] = []
  const pairing: PairingHttp = {
    setAccountSync: unused,
    setDeviceSync: async (id, enabled) => {
      calls.push(`device ${id} ${enabled}`)
    },
    disableDeviceSync: async (id) => {
      calls.push(`disable ${id}`)
      return off()
    },
    listPending: unused,
    openPending: unused,
    readPending: unused,
    answerPending: unused,
    revealPending: unused,
  }
  return { input: { account: ACCOUNT, serviceDeviceId: DEVICE, pinDir, pairing }, pinDir, calls }
}

test("#given sync on for this device #when it is disabled #then the service switch is cleared for this device, the device is off locally and the answer is off", async () => {
  const d = await device()
  expect(await isDeviceSyncOff(d.pinDir, ACCOUNT)).toBe(false)
  expect(await disableSync(d.input)).toEqual({ kind: "off" })
  expect(d.calls).toEqual([`disable ${DEVICE}`])
  expect(await isDeviceSyncOff(d.pinDir, ACCOUNT)).toBe(true)
})

test("#given a device already off #when it is disabled again #then the answer is off again and it stays off", async () => {
  const d = await device()
  await disableSync(d.input)
  expect(await disableSync(d.input)).toEqual({ kind: "off" })
  expect(await isDeviceSyncOff(d.pinDir, ACCOUNT)).toBe(true)
})

test("#given the service refuses #when disable runs #then the answer carries the closed refusal code and nothing is turned off locally", async () => {
  const d = await device(async () => ({ ok: false, code: "not_found" }))
  expect(await disableSync(d.input)).toEqual({ kind: "refused", code: "not_found" })
  expect(await isDeviceSyncOff(d.pinDir, ACCOUNT)).toBe(false)
})

test("#given the service cannot be reached #when disable runs #then it throws and this device is still on locally", async () => {
  const d = await device(async () => {
    throw new TypeError("fetch failed")
  })
  await expect(disableSync(d.input)).rejects.toThrow("fetch failed")
  expect(await isDeviceSyncOff(d.pinDir, ACCOUNT)).toBe(false)
})

test("#given an operation whose owner has retired #when disable runs #then nothing reaches the service", async () => {
  const d = await device()
  const authority = {
    signal: new AbortController().signal,
    admit: (): never => {
      throw new Error("retired")
    },
  }
  await expect(disableSync({ ...d.input, authority })).rejects.toThrow("retired")
  expect(d.calls).toEqual([])
  expect(await isDeviceSyncOff(d.pinDir, ACCOUNT)).toBe(false)
})

test("#given a device turned off #when sync is turned on for it again #then the service switch is set and the device is on locally", async () => {
  const d = await device()
  await disableSync(d.input)
  await turnDeviceSyncOn(d.input)
  expect(d.calls).toEqual([`disable ${DEVICE}`, `device ${DEVICE} true`])
  expect(await isDeviceSyncOff(d.pinDir, ACCOUNT)).toBe(false)
})

test("#given another account on this machine #when one account's device is turned off #then the other account is still on", async () => {
  const d = await device()
  await disableSync(d.input)
  expect(await isDeviceSyncOff(d.pinDir, "another-account")).toBe(false)
})

test("#given this device's sync is off #when a sync session is opened #then it stays idle as sync_off without a request", async () => {
  const d = await device()
  const session = {
    account: ACCOUNT,
    keyring: createInMemoryDeviceKeyring("p"),
    pinDir: d.pinDir,
    spaceId: new Uint8Array(16),
    baseUrl: "https://service.invalid",
    token: (): never => {
      throw new Error("no request is expected")
    },
  }
  // Control: with sync on and no trust pin, the session is idle for the pin, so the answer below is the switch's.
  expect(await openAccountSession(session)).toEqual({ ok: false, reason: "no_pin" })
  await disableSync(d.input)
  expect(await openAccountSession(session)).toEqual({ ok: false, reason: "sync_off" })
})
