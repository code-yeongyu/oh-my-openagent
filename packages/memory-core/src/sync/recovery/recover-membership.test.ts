import { afterAll, expect, test } from "bun:test"
import { readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createRejectionCounter } from "../crypto/rejection.ts"
import { createRecoveryBridge } from "./bridge.ts"
import { readRecoveryStatus } from "./membership.ts"
import type { RecoveryTransport } from "./ports.ts"
import { recoverOnFreshDevice } from "./recover.ts"
import { fakeAuthenticator } from "./testing/fake-passkey.test-support.ts"
import { pinnedDir } from "./testing/pinned-dir.test-support.ts"
import {
  approve,
  createWorld,
  type Device,
  freshStateDir,
  newDevice,
  removeWorldStateDirs,
  rotate,
  RP_ID,
  transportFor,
  type World,
} from "./testing/world.test-support.ts"

afterAll(removeWorldStateDirs)

const spiedRecover = async (world: World, device: Device, stateDir: string) => {
  const inner = createRecoveryBridge(fakeAuthenticator(world.provider), device.keyring)
  const calls = { begin: 0, finish: 0, abort: 0 }
  const bridge = {
    ...inner,
    recoverBegin: (request: Parameters<typeof inner.recoverBegin>[0]) => {
      calls.begin += 1
      return inner.recoverBegin(request)
    },
    recoverFinish: (request: Parameters<typeof inner.recoverFinish>[0]) => {
      calls.finish += 1
      return inner.recoverFinish(request)
    },
    recoverAbort: (handle: string) => {
      calls.abort += 1
      return inner.recoverAbort(handle)
    },
  }
  const before = world.server.chain(world.account).length
  const outcome = await recoverOnFreshDevice({
    account: world.account,
    rpId: RP_ID,
    keyring: device.keyring,
    bridge,
    transport: transportFor(world, device),
    rejections: createRejectionCounter(),
    stateDir,
  })
  return { outcome, calls, appended: world.server.chain(world.account).length - before }
}

test("#given a pinned member of the account #when it asks to recover #then it refuses already-member before the bridge is called and appends nothing", async () => {
  const world = await createWorld()
  const { outcome, calls, appended } = await spiedRecover(world, world.owner, await pinnedDir(world))
  expect(outcome).toEqual({ ok: false, reason: "already-member" })
  expect(calls).toEqual({ begin: 0, finish: 0, abort: 0 })
  expect(appended).toBe(0)
})

test("#given a member whose pin was deleted #when it recovers #then the recovery-anchored walk finds it, finish never runs and the handle is aborted once", async () => {
  const world = await createWorld()
  const { outcome, calls, appended } = await spiedRecover(world, world.owner, freshStateDir())
  expect(outcome).toEqual({ ok: false, reason: "already-member" })
  expect(calls).toEqual({ begin: 1, finish: 0, abort: 1 })
  expect(appended).toBe(0)
})

test("#given a pinned device that was retired from the chain #when it recovers #then the guard lets it reach begin and it recovers", async () => {
  const world = await createWorld()
  const second = await newDevice()
  await approve(world, second)
  const dir = await pinnedDir(world)
  await rotate(world, world.owner, [world.owner.principal])
  const { outcome, calls } = await spiedRecover(world, second, dir)
  expect(calls.begin).toBe(1)
  expect(outcome).toMatchObject({ ok: true, state: "recovered" })
})

test("#given a pinned device and a served chain that does not verify #when it recovers #then it refuses before the bridge with the walk's reason", async () => {
  const world = await createWorld()
  const dir = await pinnedDir(world)
  const broken: RecoveryTransport = { ...transportFor(world, world.owner), listEntries: async () => null }
  const bridge = createRecoveryBridge(fakeAuthenticator(world.provider), world.owner.keyring)
  let begun = 0
  const outcome = await recoverOnFreshDevice({
    account: world.account,
    rpId: RP_ID,
    keyring: world.owner.keyring,
    bridge: {
      ...bridge,
      recoverBegin: (request) => {
        begun += 1
        return bridge.recoverBegin(request)
      },
    },
    transport: broken,
    rejections: createRejectionCounter(),
    stateDir: dir,
  })
  expect(outcome).toEqual({ ok: false, reason: "unavailable" })
  expect(begun).toBe(0)
})

test("#given a pinned device served a chain from another genesis #when it recovers #then it refuses pin-conflict with the repair step before any window opens", async () => {
  const world = await createWorld()
  const other = await createWorld(world.account)
  const { outcome, calls } = await spiedRecover(other, other.owner, await pinnedDir(world))
  expect(outcome).toEqual({ ok: false, reason: "pin-conflict", next: "re-pair or recover" })
  expect(calls.begin).toBe(0)
})

test("#given the recovery status read #when the device is a pinned member, unpinned, or its walk fails #then member is true, false, or the whole field is absent", async () => {
  const world = await createWorld()
  const owner = world.owner.principal.id
  const read = (stateDir: string, transport: RecoveryTransport = transportFor(world, world.owner)) =>
    readRecoveryStatus({ transport, account: world.account, stateDir, deviceId: owner })
  expect(await read(await pinnedDir(world))).toEqual({ method: "passkey", member: true })
  expect(await read(freshStateDir())).toEqual({ method: "passkey", member: false })
  const broken: RecoveryTransport = { ...transportFor(world, world.owner), listEntries: async () => null }
  expect(await read(await pinnedDir(world), broken)).toBeNull()
})

test("#given a corrupt pin or a pin naming another genesis #when status reads recovery #then it reports the blocked pin instead of a member reading", async () => {
  const world = await createWorld()
  const other = await createWorld(world.account)
  const read = (stateDir: string) =>
    readRecoveryStatus({
      transport: transportFor(other, other.owner),
      account: world.account,
      stateDir,
      deviceId: other.owner.principal.id,
    })
  expect(await read(await pinnedDir(world))).toEqual({ blocked: "pin-conflict" })
  const corrupt = await pinnedDir(world)
  const [entry] = readdirSync(join(corrupt, readdirSync(corrupt)[0] ?? ""), {
    recursive: true,
    withFileTypes: true,
  }).filter((item) => item.isFile())
  if (entry === undefined) throw new Error("no pin file")
  writeFileSync(join(entry.parentPath, entry.name), "{")
  expect(await read(corrupt)).toEqual({ blocked: "pin-corrupt" })
})

test("#given the recovery status read with a pin #when it walks the chain #then it reads the keyring once", async () => {
  const world = await createWorld()
  const base = transportFor(world, world.owner)
  let keyReads = 0
  const counted: RecoveryTransport = {
    ...base,
    listKeys: (operation) => {
      keyReads += 1
      return base.listKeys(operation)
    },
  }
  const status = await readRecoveryStatus({
    transport: counted,
    account: world.account,
    stateDir: await pinnedDir(world),
    deviceId: world.owner.principal.id,
  })
  expect(status).toEqual({ method: "passkey", member: true })
  expect(keyReads).toBe(1)
})
