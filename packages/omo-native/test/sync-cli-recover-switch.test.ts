import { afterAll, expect, test } from "bun:test"
import { disableSync, isDeviceSyncOff } from "../../memory-core/src/sync/account/device-switch"
import { createPairingHttp } from "../../memory-core/src/sync/account/pairing-http"
import { freshStateDir, removeWorldStateDirs } from "../../memory-core/src/sync/recovery/testing/world.test-support"
import { OFFLINE, words, ENROLLED, typing, consentService, runRecover } from "./sync-cli-recover.test-support"

afterAll(removeWorldStateDirs)

test("#given a service that gates reads on the device switch #when the enrolled phrase recovers the device #then both switches are on, the off mark is gone and a pull answers 200", async () => {
  const service = consentService()
  const pinDir = freshStateDir()
  const account = "acct-recovery"
  await disableSync({
    account,
    serviceDeviceId: "svc-fresh",
    pinDir,
    pairing: { ...createPairingHttp(OFFLINE), disableDeviceSync: async () => ({ ok: true }) },
  })
  expect(service.pull()).toBe(403)
  const terminal = typing([ENROLLED.join(" ")])
  const r = await runRecover({ terminal: terminal.open }, { pairing: service.pairing, pinDir })
  expect(r.exit).toBe(0)
  expect(r.out).toContain("Your memory is recovered on this device and memory sync is on.")
  expect(service.state).toEqual({ account: true, device: true })
  expect(await isDeviceSyncOff(pinDir, account)).toBe(false)
  expect(service.pull()).toBe(200)
})

test("#given recovery succeeds but the device switch call fails #when omo sync recover runs #then it is still recovered, never says sync is on, names the cause and omo sync enable, and exits 1", async () => {
  const service = consentService(true)
  const terminal = typing([ENROLLED.join(" ")])
  const r = await runRecover({ terminal: terminal.open }, { pairing: service.pairing })
  expect(r.exit).toBe(1)
  expect(r.out).toEqual([])
  expect(r.err.join("\n")).toContain(
    "Your memory is recovered on this device, but memory sync could not be turned on (",
  )
  expect(r.err.join("\n")).toContain("`omo sync enable`")
  expect(service.pull()).toBe(403)
})

test("#given a phrase that does not match #when omo sync recover refuses #then neither switch was touched", async () => {
  const service = consentService()
  const terminal = typing([words(99).join(" ")])
  const r = await runRecover({ terminal: terminal.open }, { pairing: service.pairing })
  expect(r.exit).toBe(1)
  expect(service.state).toEqual({ account: false, device: false })
})
