import { afterAll, expect, test } from "bun:test"
import { join } from "node:path"
import { disableSync } from "../../../../memory-core/src/sync/account/device-switch"
import { createPairingHttp } from "../../../../memory-core/src/sync/account/pairing-http"
import { createRecoveryBridge } from "../../../../memory-core/src/sync/recovery/bridge"
import { fakeAuthenticator } from "../../../../memory-core/src/sync/recovery/testing/fake-passkey.test-support"
import { pinnedDir } from "../../../../memory-core/src/sync/recovery/testing/pinned-dir.test-support"
import {
  createWorld,
  type Device,
  removeWorldStateDirs,
  RP_ID,
  type World,
} from "../../../../memory-core/src/sync/recovery/testing/world.test-support"
import type { SyncOperationOptions } from "../../../../memory-core/src/sync/operation-authority"
import { createSyncRpcClaims } from "./sync-rpc-claims"
import type { SyncRpcAuthority } from "./sync-rpc-ports"
import { ENROLLED, enrolledWorld, fakeMain, recoverHarness, removeRecoverRoots } from "./sync-rpc-recover.test-support"

afterAll(() => {
  removeWorldStateDirs()
  removeRecoverRoots()
})

/** Stands in for desktop main on the passkey method: the reference bridge over the world's fake authenticator. */
const passkeyMain = (world: World) => (device: Device) => {
  const bridge = createRecoveryBridge(fakeAuthenticator(world.provider), device.keyring)
  return async (op: string, data: unknown): Promise<unknown> => {
    const request = Object(data)
    if (op === "recoverBegin") return { op, ...(await bridge.recoverBegin(request)) }
    if (op === "recoverFinish") return { op, ...(await bridge.recoverFinish(request)) }
    await bridge.recoverAbort(String(Reflect.get(request, "handle")))
    return { op: "recoverAbort" }
  }
}

const statusRecovery = async (rpc: Awaited<ReturnType<typeof recoverHarness>>): Promise<unknown> =>
  Reflect.get(Object(await rpc.call("status")), "recovery")

const authority = (): SyncRpcAuthority => ({
  signal: new AbortController().signal,
  admit: (effect) => effect(),
  boundary: async (effect) => effect(),
})

test("#given an account recovered by passkey #when RPC recover runs with the passkey method #then the device recovers with sync on", async () => {
  const world = await createWorld()
  const rpc = await recoverHarness({ world, rpId: RP_ID, prfSupported: true, main: passkeyMain(world) })
  expect(await rpc.call("recover", { method: "passkey" })).toEqual({ kind: "recovered", sync: "on" })
  expect(rpc.gate.state).toEqual({ account: true, device: true })
})

test("#given an account whose only recovery key is a passkey #when RPC recover runs with the phrase method #then it refuses no-recovery-key and no window opens", async () => {
  const world = await createWorld()
  const rpc = await recoverHarness({ world, main: (device) => fakeMain(device, [ENROLLED.join(" ")]) })
  expect(await rpc.call("recover", { method: "phrase" })).toEqual({ kind: "recover_refused", code: "no-recovery-key" })
  expect(rpc.frames).toEqual([])
})

test("#given a desktop without the phraseRecover descriptor #when features, status and recover are asked #then recover is not listed, status has no recovery and recover refuses surface-unavailable", async () => {
  const world = await enrolledWorld()
  const rpc = await recoverHarness({
    world,
    phraseRecover: "unsupported",
    main: (device) => fakeMain(device, [ENROLLED.join(" ")]),
  })
  expect(Object(await rpc.call("features")).features).not.toContain("recover")
  expect(await statusRecovery(rpc)).toBeUndefined()
  expect(await rpc.call("recover", { method: "phrase" })).toEqual({
    kind: "recover_refused",
    code: "surface-unavailable",
  })
  expect(rpc.frames).toEqual([])
})

test("#given the runtime and the phraseRecover descriptor #when features is asked #then recover is listed", async () => {
  const rpc = await recoverHarness({ world: await enrolledWorld(), main: (device) => fakeMain(device, []) })
  expect(Object(await rpc.call("features")).features).toContain("recover")
})

test("#given an account source that rejects #when features is asked #then the answer still lists the other features and only recover is left out (#14464 L1)", async () => {
  const rpc = await recoverHarness({
    world: await enrolledWorld(),
    sourceFails: true,
    main: (device) => fakeMain(device, []),
  })
  const answer = Object(await rpc.call("features"))
  expect(answer.features).toEqual(expect.arrayContaining(["enable-method", "acknowledge", "disable"]))
  expect(answer.features).not.toContain("recover")
})

test("#given another process holding the enable ceremony claim #when RPC recover runs #then it answers in_progress and no window opens", async () => {
  const world = await enrolledWorld()
  const rpc = await recoverHarness({ world, main: (device) => fakeMain(device, [ENROLLED.join(" ")]) })
  const claims = createSyncRpcClaims(join(rpc.memoryRoot, "runtime", "sync-rpc-claims"))
  const held = await claims.acquire(rpc.account.descriptor, "enable", undefined, authority())
  expect(held).not.toBeNull()
  expect(await rpc.call("recover", { method: "phrase" })).toEqual({ kind: "in_progress" })
  expect(rpc.frames).toEqual([])
  await held?.release()
})

const memberCases = [
  ["a syncing member", false, async () => ({ state: "synced" as const })],
  ["a member turned off by disableSync", true, async () => undefined],
  ["a member with no bound session", false, async () => undefined],
] as const

for (const [label, turnedOff, syncStatus] of memberCases) {
  test(`#given ${label} #when RPC recover and status run #then recover refuses already-member before the bridge, nothing is appended and status reads member true`, async () => {
    const world = await enrolledWorld()
    const pinDir = await pinnedDir(world)
    if (turnedOff)
      await disableSync({
        account: world.account,
        serviceDeviceId: "svc-fresh",
        pinDir,
        pairing: {
          ...createPairingHttp({ baseUrl: "https://unused.invalid", token: () => "" }),
          disableDeviceSync: async () => ({ ok: true }),
        },
      })
    const rpc = await recoverHarness({
      world,
      device: world.owner,
      pinDir,
      syncStatus,
      main: (device) => fakeMain(device, [ENROLLED.join(" ")]),
    })
    const before = world.server.chain(world.account).length
    expect(await rpc.call("recover", { method: "phrase" })).toEqual({ kind: "recover_refused", code: "already-member" })
    expect(rpc.frames).toEqual([])
    expect(world.server.chain(world.account).length).toBe(before)
    expect(await statusRecovery(rpc)).toEqual({ method: "both", member: true })
  })
}

test("#given status on a fresh device #when the keyring holds passkeys, phrases, both or nothing #then recovery names that method with member false", async () => {
  const world = await enrolledWorld()
  const phraseRow = (row: unknown) => JSON.stringify(row).includes('"survivable":"phrase"')
  const keyring = (keep: (row: unknown) => boolean) => ({
    listKeys: async (operation?: SyncOperationOptions) => {
      const rows = await world.server.transport(world.account, { ...world.owner.principal }).listKeys(operation)
      return Array.isArray(rows) ? rows.filter(keep) : rows
    },
  })
  const read = async (chain?: Record<string, unknown>) =>
    statusRecovery(await recoverHarness({ world, main: (device) => fakeMain(device, []), ...(chain && { chain }) }))
  expect(await read()).toEqual({ method: "both", member: false })
  expect(await read(keyring((row) => !phraseRow(row)))).toEqual({ method: "passkey", member: false })
  expect(await read(keyring(phraseRow))).toEqual({ method: "phrase", member: false })
  expect(await read(keyring(() => false))).toEqual({ method: "none", member: false })
})

test("#given a keyring read that fails, or a pin naming another genesis #when status runs #then recovery is absent for the failure and blocked pin-conflict for the pin", async () => {
  const world = await enrolledWorld()
  const failing = await recoverHarness({
    world,
    main: (device) => fakeMain(device, []),
    chain: { listKeys: async () => null },
  })
  expect(await statusRecovery(failing)).toBeUndefined()
  const other = await createWorld(world.account)
  const conflicted = await recoverHarness({
    world: other,
    device: other.owner,
    pinDir: await pinnedDir(world),
    main: (device) => fakeMain(device, []),
  })
  expect(await statusRecovery(conflicted)).toEqual({ blocked: "pin-conflict" })
  expect(await conflicted.call("recover", { method: "phrase" })).toEqual({
    kind: "recover_refused",
    code: "pin-conflict",
  })
})
