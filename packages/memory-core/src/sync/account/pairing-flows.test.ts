import { afterAll, afterEach, describe, expect, test } from "bun:test"

import { creatorAnchor } from "../crypto/anchor.ts"
import { appendEntries, emptyChain } from "../crypto/chain.ts"
import { wrapSetDigest } from "../crypto/links.ts"
import { createRejectionCounter } from "../crypto/rejection.ts"
import { pinTrustAnchor } from "../crypto/trust-pin.ts"
import { sealWrap } from "../recovery/key-material.ts"
import { ownMaterial, signedAppend } from "../recovery/keyring-append.ts"
import { committedWrap, expectedHistory } from "../recovery/served-chain.ts"
import { approve, createWorld, type Device, freshStateDir, newDevice, removeWorldStateDirs, verified, type World } from "../recovery/testing/world.test-support.ts"
import { approveDevice } from "./approve.ts"
import { enableSync } from "./enable.ts"
import { createAccountHttp } from "./http.ts"
import { type CeremonyClock, joinAccount } from "./join.ts"
import { createPairingHttp } from "./pairing-http.ts"
import { openAccountSession } from "./session.ts"
import { type ChainWireServer, startChainWireServer } from "./testing/chain-wire-server.test-support.ts"

const servers: ChainWireServer[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop()
})
afterAll(removeWorldStateDirs)

async function pinnedDir(world: World): Promise<string> {
  const walked = await appendEntries(emptyChain(world.account, creatorAnchor(world.account, world.owner.keyring)), world.server.chain(world.account), createRejectionCounter())
  if (!walked.ok || walked.state.pin === null) throw new Error("the fixture genesis does not anchor")
  const dir = freshStateDir()
  await pinTrustAnchor(dir, world.account, walked.state.pin)
  return dir
}

const clock = (): CeremonyClock & { expire(): void } => {
  let skew = 0
  return { now: () => Date.now() + skew, sleep: () => new Promise((resolve) => setImmediate(resolve)), expire: () => { skew = 3_600_000 } }
}

async function until<T>(read: () => T | undefined, what: string): Promise<T> {
  const deadline = Date.now() + 10_000
  for (;;) {
    const value = read()
    if (value !== undefined) return value
    if (Date.now() > deadline) throw new Error(`waited 10s for ${what}`)
    await new Promise((resolve) => setImmediate(resolve))
  }
}

async function setup() {
  const world = await createWorld("acct-pairing")
  const server = startChainWireServer(world.account, world.server.chain(world.account))
  servers.push(server)
  const http = (device: Device) => {
    const token = server.tokenFor({ ...device.principal })
    const options = { baseUrl: server.url, token: () => token }
    return { chain: createAccountHttp(options), pairing: createPairingHttp(options) }
  }
  return { world, server, http }
}

describe("pairing a new device", () => {
  test("both screens show one code, the approval admits the device, and it then gets a sync session", async () => {
    const { world, server, http } = await setup()
    const joining = await newDevice()
    const joinerPins = freshStateDir()
    const codes: string[] = []
    const join = joinAccount({ account: world.account, keyring: joining.keyring, pinDir: joinerPins, ...http(joining), clock: clock(), showCode: (code) => { codes.push(`joining ${code}`) } })
    const pending = await until(() => server.pending()[0], "the joining device's pending pairing")
    const approved = await approveDevice({
      account: world.account, keyring: world.owner.keyring, pinDir: await pinnedDir(world), ...http(world.owner), clock: clock(), pendingId: pending.id,
      confirmCode: async (code) => { codes.push(`approver ${code}`); return true },
    })
    expect(approved.kind).toBe("approved")
    expect(await join).toEqual({ kind: "joined" })
    const [joinerCode, approverCode] = [codes.find((c) => c.startsWith("joining"))?.split(" ")[1], codes.find((c) => c.startsWith("approver"))?.split(" ")[1]]
    expect(joinerCode).toMatch(/^\d{6}$/)
    expect(joinerCode).toBe(approverCode)
    const token = server.tokenFor({ ...joining.principal })
    const session = await openAccountSession({ baseUrl: server.url, token: () => token, account: world.account, keyring: joining.keyring, pinDir: joinerPins, spaceId: new Uint8Array(16) })
    expect(session.ok).toBe(true)
  }, 30_000)

  test("a relay that substitutes the joining device's keys in the reveal is refused before anything is signed", async () => {
    const { world, server, http } = await setup()
    const joining = await newDevice()
    const impostor = await newDevice()
    server.tamperReveal = (reveal) => ({ ...reveal, principal: { ...impostor.principal } })
    const joinClock = clock()
    const join = joinAccount({ account: world.account, keyring: joining.keyring, pinDir: freshStateDir(), ...http(joining), clock: joinClock, showCode: () => undefined })
    const pending = await until(() => server.pending()[0], "the joining device's pending pairing")
    const length = world.server.chain(world.account).length
    const outcome = await approveDevice({ account: world.account, keyring: world.owner.keyring, pinDir: await pinnedDir(world), ...http(world.owner), clock: clock(), pendingId: pending.id, confirmCode: async () => true })
    expect(outcome).toMatchObject({ kind: "refused" })
    expect(world.server.chain(world.account).length).toBe(length)
    joinClock.expire()
    expect(await join).toEqual({ kind: "expired" })
  }, 30_000)

  test("a person who sees different codes declines, and no approval is appended", async () => {
    const { world, server, http } = await setup()
    const joining = await newDevice()
    const joinClock = clock()
    const join = joinAccount({ account: world.account, keyring: joining.keyring, pinDir: freshStateDir(), ...http(joining), clock: joinClock, showCode: () => undefined })
    const pending = await until(() => server.pending()[0], "the joining device's pending pairing")
    const length = world.server.chain(world.account).length
    expect(await approveDevice({ account: world.account, keyring: world.owner.keyring, pinDir: await pinnedDir(world), ...http(world.owner), clock: clock(), pendingId: pending.id, confirmCode: async () => false })).toEqual({ kind: "declined" })
    expect(world.server.chain(world.account).length).toBe(length)
    joinClock.expire()
    expect(await join).toEqual({ kind: "expired" })
  }, 30_000)

  test("an approval another member signs over the genuine transcript is not this device's admission", async () => {
    const { world, server, http } = await setup()
    const operatorDevice = await newDevice()
    await approve(world, operatorDevice)
    const joining = await newDevice()
    const join = joinAccount({ account: world.account, keyring: joining.keyring, pinDir: freshStateDir(), ...http(joining), clock: clock(), showCode: () => undefined })
    const pending = await until(() => server.pending()[0], "the joining device's pending pairing")
    const forgeWithGenuineTranscript = async (): Promise<boolean> => {
      const row = server.pending()[0]
      const joiningNonce = field(row?.reveal, "joining_nonce")
      const approverNonce = field(row?.answer, "approver_nonce")
      if (row === undefined || joiningNonce === undefined || approverNonce === undefined) throw new Error("the ceremony did not reach the code")
      await appendApproval(world, operatorDevice, joining, { commitment: row.commitment, joining_nonce: joiningNonce, approver_nonce: approverNonce })
      return false
    }
    await approveDevice({ account: world.account, keyring: world.owner.keyring, pinDir: await pinnedDir(world), ...http(world.owner), clock: clock(), pendingId: pending.id, confirmCode: forgeWithGenuineTranscript })
    expect(await join).toEqual({ kind: "refused", reason: "the approval does not match this device's ceremony" })
  }, 30_000)
})

const field = (value: unknown, key: string): string | undefined => {
  if (typeof value !== "object" || value === null) return undefined
  const found: unknown = Reflect.get(value, key)
  return typeof found === "string" ? found : undefined
}

async function appendApproval(world: World, by: Device, joining: Device, pairing: { commitment: string; joining_nonce: string; approver_nonce: string }): Promise<void> {
  const state = await verified(world, by)
  const authority = state.authority
  if (authority === null || state.head === null) throw new Error("no authority")
  const wrap = committedWrap(state, authority.epoch, `device:${by.principal.id}`)
  const material = wrap === null ? null : await ownMaterial(by.keyring, world.account, wrap, expectedHistory(authority, authority.epoch))
  if (material === null) throw new Error("the member cannot open its wrap")
  const wraps = [await sealWrap({ account: world.account, epoch: authority.epoch, id: `device:${joining.principal.id}` }, joining.principal.sealing_public_key, material)]
  const digest = await wrapSetDigest(wraps)
  if (!digest.ok) throw new Error("wraps")
  const body = { kind: "approval", account: world.account, epoch: authority.epoch, principal: { ...joining.principal }, wraps_digest: digest.digest, pairing }
  const appended = await world.server.transport(world.account, { ...by.principal }).appendKeys(await signedAppend(by.keyring, state.head, body, wraps))
  if (!appended.ok) throw new Error(`the forged approval was not admitted: ${appended.reason}`)
}

describe("turning sync on", () => {
  test("switches go on first; an empty keyring needs the first device, a stranger joins, a member is on", async () => {
    const { world, server, http } = await setup()
    const ownerPins = await pinnedDir(world)
    const stranger = await newDevice()
    const enable = (device: Device, pinDir: string, chain = http(device)) =>
      enableSync({ account: world.account, serviceDeviceId: `svc-${device.principal.id}`, keyring: device.keyring, pinDir, ...chain })
    expect(await enable(world.owner, ownerPins)).toEqual({ kind: "joined" })
    expect(await enable(stranger, freshStateDir())).toEqual({ kind: "join_required" })
    expect(server.switches.filter((line) => line.startsWith("/v1/account/sync")).length).toBe(2)

    const empty = startChainWireServer("acct-empty", [])
    servers.push(empty)
    const token = empty.tokenFor({ ...stranger.principal })
    const options = { baseUrl: empty.url, token: () => token }
    expect(await enableSync({ account: "acct-empty", serviceDeviceId: "svc", keyring: stranger.keyring, pinDir: freshStateDir(), chain: createAccountHttp(options), pairing: createPairingHttp(options) })).toEqual({ kind: "needs_first_device" })
  }, 30_000)
})
