// The freeze settler's own decisions (#12280 R-A6, R-A7(b), R-A10): the device-list view, the
// unverified-chain refusal, the in-process single-flight, the rule-7 bound, and the freezes it must
// leave to a dedicated rotation. Real chains on the chain wire server; the device list is the real
// reply, edited only where a case needs a row the service would not serve.

import { expect, test } from "bun:test"

import { appendEntries, emptyChain } from "../crypto/chain.ts"
import { createRejectionCounter } from "../crypto/rejection.ts"
import { buildFork } from "../crypto/testing/fork.ts"
import { ACCOUNT as FIXTURE_ACCOUNT, fixtureAnchor, keyringFor, mainChain } from "../crypto/testing/sync-v1.test-support.ts"
import { loadTrustAnchor } from "../crypto/trust-pin.ts"
import { GIT_TEST_TIMEOUT } from "../engine/engine-harness.test-support.ts"
import type { DeviceKeyring } from "../keyring-port.ts"
import { signedAppend } from "../recovery/keyring-append.ts"
import { openAccountChain } from "./account-chain.ts"
import { chainGate } from "./freeze-eligibility.ts"
import { createFreezeSettler, type FreezeEvent } from "./freeze-settler.ts"
import { type AccountHttp, createAccountHttp } from "./http.ts"
import { parseRevocationView, type RevocationView } from "./revocation-view.ts"
import { ACCOUNT } from "./testing/genesis-enable.test-support.ts"
import { revokeWorld, type World, type WorldDevice } from "./testing/revoke-world.test-support.ts"

const TIMEOUT = GIT_TEST_TIMEOUT * 4
let scopes = 0

/** The device list exactly as the service serves it to `device`. */
const servedList = async (w: World, device: WorldDevice): Promise<{ devices: Record<string, unknown>[] }> =>
  (await w.call(device, "GET", "/v1/devices")).json() as Promise<{ devices: Record<string, unknown>[] }>

async function settlerFor(w: World, device: WorldDevice, options: {
  readonly view?: () => Promise<RevocationView>
  readonly http?: (http: AccountHttp) => AccountHttp
  readonly scope?: string
} = {}) {
  const pin = await loadTrustAnchor(device.pinDir, ACCOUNT)
  if (!pin.ok) throw new Error("no pin")
  const real = createAccountHttp({ baseUrl: w.f.server.url, token: () => device.token })
  const http = options.http?.(real) ?? real
  const chain = await openAccountChain({ account: ACCOUNT, anchor: pin.anchor, keyring: device.keyring, http, rejections: createRejectionCounter() })
  const events: FreezeEvent[] = []
  const settler = createFreezeSettler({
    chain, http, keyring: device.keyring, scope: options.scope ?? `settler-test-${(scopes += 1)}`,
    revocationView: options.view ?? (async () => parseRevocationView(await servedList(w, device))),
    onEvent: (event) => events.push(event), sleep: async () => undefined,
  })
  return { settler, events }
}

const without = (list: { devices: Record<string, unknown>[] }, device: WorldDevice) =>
  ({ devices: list.devices.filter((row) => row["syncPrincipal"] !== device.keyring.principal().id) })

test("R-A10(a,b) #given a frozen account #when the device list shows this device revoked, or names no principal #then the settler appends nothing", async () => {
  const w = await revokeWorld()
  try {
    const b = await w.join("b", 20)
    await w.call(w.a, "DELETE", `/v1/devices/${b.serviceDeviceId}`)
    const before = w.f.server.keyAppendsReceived
    const self = w.a.keyring.principal().id
    const revoked = await settlerFor(w, w.a, { view: async () => ({ kind: "usable", self, selfRevoked: true, revoked: new Set([self]), listed: new Set([self]) }) })
    expect(await revoked.settler.settle()).toEqual({ kind: "frozen", reason: "self_revoked" })
    const nameless = await settlerFor(w, w.a, {
      view: async () => parseRevocationView({ devices: (await servedList(w, w.a)).devices.map((row) => ({ ...row, syncPrincipal: null })) }),
    })
    expect(await nameless.settler.settle()).toEqual({ kind: "frozen", reason: "device_list_unusable" })
    expect(w.f.server.keyAppendsReceived).toBe(before)
  } finally {
    await w.close()
  }
}, TIMEOUT)

test("R-A10(c,d) #given a row of an unknown kind and platform and a member no row names #then the rotation proceeds, keeps the unlisted member, and counts it", async () => {
  const w = await revokeWorld()
  try {
    const b = await w.join("b", 20)
    const c = await w.join("c", 30)
    await w.call(w.a, "DELETE", `/v1/devices/${b.serviceDeviceId}`)
    const extra = { id: "x", name: "x", kind: "server", platform: "freebsd", current: false, syncing: true, revokedAt: null, syncPrincipal: "AAAAAAAAAAAAAAAAAAAAAA" }
    const { settler, events } = await settlerFor(w, w.a, {
      view: async () => parseRevocationView({ devices: [...without(await servedList(w, w.a), c).devices, extra] }),
    })
    expect(await settler.settle()).toEqual({ kind: "rotated" })
    expect(w.rotations()).toEqual([[w.a.keyring.principal().id, c.keyring.principal().id].sort()])
    expect(events.filter((event) => event === "sync.keyring.member_unlisted")).toHaveLength(1)
  } finally {
    await w.close()
  }
}, TIMEOUT)

test("R-A10(e) #given a list that omits a member the service's register holds as revoked #then one append is refused forbidden, one re-read changes nothing, and no second append follows", async () => {
  const w = await revokeWorld()
  try {
    const b = await w.join("b", 20)
    const c = await w.join("c", 30)
    await w.call(w.a, "DELETE", `/v1/devices/${b.serviceDeviceId}`)
    await w.call(w.a, "DELETE", `/v1/devices/${c.serviceDeviceId}`)
    const before = w.f.server.keyAppendsReceived
    const scope = "settler-test-disagreeing-list"
    const view = async () => parseRevocationView(without(await servedList(w, w.a), c))
    const first = await settlerFor(w, w.a, { view, scope })
    expect(await first.settler.settle()).toEqual({ kind: "frozen", reason: "refused" })
    expect(first.events).toContain("sync.keyring.rotation_refused")
    expect(w.f.server.keyAppendsReceived - before).toBe(1)
    const again = await settlerFor(w, w.a, { view, scope })
    expect(await again.settler.settle()).toEqual({ kind: "frozen", reason: "refused" })
    expect(w.f.server.keyAppendsReceived - before).toBe(1)
    expect(w.rotations()).toEqual([])
  } finally {
    await w.close()
  }
}, TIMEOUT)

test("#given a state route serving a head the verified chain cannot reach #then the settler reports unverified and appends nothing", async () => {
  const w = await revokeWorld()
  try {
    const b = await w.join("b", 20)
    await w.call(w.a, "DELETE", `/v1/devices/${b.serviceDeviceId}`)
    const before = w.f.server.keyAppendsReceived
    const { settler, events } = await settlerFor(w, w.a, {
      http: (real) => ({
        ...real,
        state: async () => {
          const served = await real.state()
          return served === null ? null : { ...served, head: { ...served.head, seq: served.head.seq + 5 } }
        },
      }),
    })
    expect(await settler.settle()).toEqual({ kind: "frozen", reason: "unverified" })
    expect(events).toContain("sync.keyring.unverified")
    expect(w.f.server.keyAppendsReceived).toBe(before)
  } finally {
    await w.close()
  }
}, TIMEOUT)

test("#given two sessions of one device for one account #when both settle at once #then one rotation is sent and both report it", async () => {
  const w = await revokeWorld()
  try {
    const b = await w.join("b", 20)
    await w.call(w.a, "DELETE", `/v1/devices/${b.serviceDeviceId}`)
    const before = w.f.server.keyAppendsReceived
    const scope = "settler-test-single-flight"
    const one = await settlerFor(w, w.a, { scope })
    const two = await settlerFor(w, w.a, { scope })
    expect(await Promise.all([one.settler.settle(), two.settler.settle()])).toEqual([{ kind: "rotated" }, { kind: "rotated" }])
    expect(w.f.server.keyAppendsReceived - before).toBe(1)
  } finally {
    await w.close()
  }
}, TIMEOUT)

test("R-A7(b) #given this process rotated once #when it appends a recovery-key removal whose own rotation did not follow #then its settler rotates again (the keyring head moved), not flag_stuck", async () => {
  const w = await revokeWorld()
  try {
    const b = await w.join("b", 20)
    await w.call(w.a, "DELETE", `/v1/devices/${b.serviceDeviceId}`)
    const scope = "settler-test-removal"
    expect(await (await settlerFor(w, w.a, { scope })).settler.settle()).toEqual({ kind: "rotated" })
    const http = createAccountHttp({ baseUrl: w.f.server.url, token: () => w.a.token })
    const served = await http.state()
    if (served === null) throw new Error("no state")
    const removal = { kind: "recovery-key-removed", account: ACCOUNT, epoch: 2, credential_id: w.f.prepared.body.bootstrap.recovery_key.credential_id }
    expect(await http.appendKeys(await signedAppend(w.a.keyring, served.head, removal, []))).toMatchObject({ ok: true })
    expect(w.f.server.freeze.pending).toBe(true)
    expect(await (await settlerFor(w, w.a, { scope })).settler.settle()).toEqual({ kind: "rotated" })
    expect(w.rotations()).toHaveLength(2)
  } finally {
    await w.close()
  }
}, TIMEOUT)

const fixtureSelf = (keyring: DeviceKeyring) => ({ id: keyring.principal().id, signing: keyring.publicKeys().signing })

test("R-A6 (guard) #given freezes set by a recovery-join, a veto, or a fork-resolution #then the settler leaves them to their dedicated rotation", async () => {
  const main = mainChain()
  const upTo = async (name: string, extra: Parameters<typeof appendEntries>[1] = []) => {
    const names = ["genesis", "recovery_key", "recovery_key_removed", "approval", "recovery_join", "post_join_rotation", "recovery_join_vetoed", "veto_rotation"]
    const walked = await appendEntries(emptyChain(FIXTURE_ACCOUNT, fixtureAnchor()), [...main.slice(0, names.indexOf(name) + 1), ...extra], createRejectionCounter())
    if (!walked.ok) throw new Error(`fixture chain refused at ${walked.seq}: ${walked.reason}`)
    return walked.state
  }
  const joined = await upTo("recovery_join")
  expect(chainGate(joined, fixtureSelf(keyringFor("recovered")))).toEqual({ kind: "frozen", reason: "waiting_recovery" })
  expect(chainGate(joined, fixtureSelf(keyringFor("owner")))).toEqual({ kind: "not_member" })
  expect(chainGate(await upTo("recovery_join_vetoed"), fixtureSelf(keyringFor("owner")))).toEqual({ kind: "frozen", reason: "waiting_unsupported_freeze" })
  const fork = await buildFork()
  const resolved = await appendEntries(emptyChain(FIXTURE_ACCOUNT, fixtureAnchor()), [...fork.ancestry, fork.branchA, await fork.resolution()], createRejectionCounter())
  if (!resolved.ok) throw new Error(`fork refused at ${resolved.seq}: ${resolved.reason}`)
  expect(chainGate(resolved.state, fixtureSelf(keyringFor("recovered")))).toEqual({ kind: "frozen", reason: "waiting_unsupported_freeze" })
})
