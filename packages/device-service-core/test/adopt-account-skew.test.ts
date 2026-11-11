import { afterEach, describe, expect, test } from "bun:test"
import { generateKeyPairSync } from "node:crypto"
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  ADOPT_ACCOUNT_MIN_SERVICE_VERSION,
  connectDeviceService,
  type DeviceCredential,
  type DeviceService,
} from "../src/index.ts"
import { validateRequest } from "../src/local-api/validate.ts"
import { startFakeOwner, type FakeOwner } from "./local-api/conformance/fake-owner.ts"
import { defaultWorld } from "./local-api/conformance/world.ts"

// Design D r9 section 3 (version skew): device.adopt carries `account` only when welcome.service_version is at or
// above relay-spec ADOPT_ACCOUNT_MIN_SERVICE_VERSION; below it the request is exactly today's, which the shipped
// relayd validator (strict, unknown fields refused) accepts.

const owners: FakeOwner[] = []
const services: DeviceService[] = []
const dirs: string[] = []
afterEach(async () => {
  for (const service of services.splice(0)) service.close()
  for (const owner of owners.splice(0)) await owner.stop()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const keys = () => ({
  signingPrivateKey: generateKeyPairSync("ed25519")
    .privateKey.export({ format: "der", type: "pkcs8" })
    .toString("base64"),
  sealingPrivateKey: generateKeyPairSync("x25519")
    .privateKey.export({ format: "der", type: "pkcs8" })
    .toString("base64"),
})

const credential = (account?: string): DeviceCredential => ({
  device: { id: "dev-self", name: "This Mac" },
  ...keys(),
  ...(account === undefined ? {} : { account }),
})

const serviceAt = async (version: string): Promise<{ owner: FakeOwner; service: DeviceService }> => {
  const dir = mkdtempSync(join(tmpdir(), "dsa-"))
  chmodSync(dir, 0o700)
  dirs.push(dir)
  const stateDir = join(dir, "ds")
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  const owner = await startFakeOwner({ stateDir, world: { ...defaultWorld(), service_version: version } })
  owners.push(owner)
  const service = await connectDeviceService({ version: "5.1.60", stateDir })
  services.push(service)
  return { owner, service }
}

describe("device.adopt account, gated on welcome.service_version", () => {
  test("the floor is relay-spec's 0.1.3", () => {
    expect(ADOPT_ACCOUNT_MIN_SERVICE_VERSION).toBe("0.1.3")
  })

  test.each(["0.1.3", "0.1.4", "0.2.0", "1.4.0"])(
    "a relayd at %s receives the account with the keys",
    async (version) => {
      const { owner, service } = await serviceAt(version)
      await service.adopt(credential("acct_42"))
      expect(owner.state.adoptions).toBe(1)
      expect(owner.state.adoptRequests.map((request) => request["account"])).toEqual(["acct_42"])
    },
  )

  // 0.1.2 shipped without omo-relay-daemon#730: it must get today's exact request.
  test.each(["0.1.0", "0.1.1", "0.1.2", "0.1.3-rc.1"])(
    "new client + old relayd %s: no account field, and the shipped validator accepts the adopt",
    async (version) => {
      const { owner, service } = await serviceAt(version)
      expect(await service.adopt(credential("acct_42"))).toEqual({ id: "dev-self", name: "This Mac" })
      expect(owner.state.adoptions).toBe(1)
      const [sent] = owner.state.adoptRequests
      expect(sent === undefined ? [] : Object.keys(sent).toSorted()).toEqual([
        "device",
        "id",
        "sealing_private_key",
        "signing_private_key",
        "type",
      ])
      expect(validateRequest(sent).ok).toBe(true)
    },
  )

  test("control: the shipped validator refuses a device.adopt that carries an account", () => {
    const { signingPrivateKey, sealingPrivateKey } = keys()
    const request = {
      id: "r1",
      type: "device.adopt",
      device: { id: "dev-self", name: "This Mac" },
      signing_private_key: signingPrivateKey,
      sealing_private_key: sealingPrivateKey,
    }
    expect(validateRequest(request).ok).toBe(true)
    expect(validateRequest({ ...request, account: "acct_42" }).ok).toBe(false)
  })

  test("a credential that names no account sends none, even to a new relayd", async () => {
    const { owner, service } = await serviceAt("0.1.3")
    await service.adopt(credential())
    expect(owner.state.adoptRequests.map((request) => "account" in request)).toEqual([false])
  })
})
