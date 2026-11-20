import { afterEach, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { registerSyncRpc } from "./sync-rpc-registration"
import { createSyncRpcClaims } from "./sync-rpc-claims"
import type { SyncRpcAccount, SyncRpcContext, SyncRpcRegistration, SyncRpcRuntime } from "./sync-rpc-ports"
import { creatorAnchor } from "../../../../memory-core/src/sync/crypto/anchor"
import { appendEntries, emptyChain } from "../../../../memory-core/src/sync/crypto/chain"
import { createRejectionCounter } from "../../../../memory-core/src/sync/crypto/rejection"
import { pinTrustAnchor, loadTrustAnchor } from "../../../../memory-core/src/sync/crypto/trust-pin"
import {
  createWorld,
  freshStateDir,
  newDevice,
  removeWorldStateDirs,
  type Device,
} from "../../../../memory-core/src/sync/recovery/testing/world.test-support"
import { createAccountHttp } from "../../../../memory-core/src/sync/account/http"
import { createPairingHttp } from "../../../../memory-core/src/sync/account/pairing-http"
import { disableSync, isDeviceSyncOff } from "../../../../memory-core/src/sync/account/device-switch"
import { openAccountSession } from "../../../../memory-core/src/sync/account/session"
import { enableSync } from "../../../../memory-core/src/sync/account/enable"
import { joinAccount } from "../../../../memory-core/src/sync/account/join"
import { approveDevice } from "../../../../memory-core/src/sync/account/approve"
import { startChainWireServer } from "../../../../memory-core/src/sync/account/testing/chain-wire-server.test-support"
import { removeTree } from "../../../../../test-support/remove-tree"

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
  await removeWorldStateDirs()
})

function manualClock() {
  const waits: (() => void)[] = []
  let waiting = Promise.withResolvers<void>()
  return {
    now: Date.now,
    sleep: async () => {
      const gate = Promise.withResolvers<void>()
      waits.push(() => gate.resolve())
      waiting.resolve()
      await gate.promise
    },
    async advance() {
      await waiting.promise
      waiting = Promise.withResolvers<void>()
      for (const release of waits.splice(0)) release()
    },
  }
}

async function setup(empty = false) {
  const world = await createWorld("rpc-pairing")
  const chain = empty ? [] : world.server.chain(world.account)
  const server = startChainWireServer(world.account, chain, { confirmDeviceOff: true })
  cleanup.push(() => server.stop())
  const claimsRoot = await mkdtemp(join(tmpdir(), "g3-wire-"))
  // The claims churn lease, lock and guard files here up to dispose; on Windows a just-unlinked one can still be
  // listed, and Bun's recursive rm then reports success but leaves the root. removeTree checks it is gone.
  cleanup.push(() => removeTree(claimsRoot))
  const joining = await newDevice()
  const memberPin = freshStateDir()
  if (!empty) {
    const anchored = await appendEntries(
      emptyChain(world.account, creatorAnchor(world.account, world.owner.keyring)),
      chain,
      createRejectionCounter(),
    )
    if (!anchored.ok || anchored.state.pin === null) throw new Error("invalid fixture genesis")
    await pinTrustAnchor(memberPin, world.account, anchored.state.pin)
  }
  const connect = (device: Device, pinDir: string) => {
    const controller = new AbortController()
    const clock = manualClock()
    const code = Promise.withResolvers<string>()
    const joined = Promise.withResolvers<void>()
    const token = server.tokenFor({ ...device.principal })
    const owner: SyncRpcContext = {
      ownerId: `owner-${device.principal.id}`,
      disconnectSignal: controller.signal,
      admit: (dispatch) => {
        controller.signal.throwIfAborted()
        return dispatch()
      },
    }
    const account: SyncRpcAccount = {
      descriptor: {
        genesis: "unsupported",
        rpId: null,
        userName: null,
        serviceOrigin: server.url,
        accountId: world.account,
        serviceDeviceId: `service-${device.principal.id}`,
        syncPrincipalId: device.principal.id,
        publicKeys: device.keyring.publicKeys(),
        generation: "g1",
        incarnation: "main-1",
      },
      signal: controller.signal,
      isCurrent: async () => !controller.signal.aborted,
      boundary: async (dispatch) => {
        controller.signal.throwIfAborted()
        return dispatch()
      },
      forOperation: async (authority) => {
        const send: typeof fetch = Object.assign(
          (request: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
            authority.admit(() => fetch(request, { ...init, signal: authority.signal })),
          { preconnect: fetch.preconnect },
        )
        const options = { baseUrl: server.url, token: () => token, fetch: send }
        return {
          keyring: device.keyring,
          chain: createAccountHttp(options),
          pairing: createPairingHttp(options),
          devices: async () => [],
          close: async () => undefined,
        }
      },
    }
    // The core at the task's base predates the observation hooks. These adapters observe the
    // real HTTP result, while all pairing, signing, verification and pinning remain core code.
    const runtime: SyncRpcRuntime = {
      enableSync,
      disableSync,
      joinAccount: async (input) => {
        const result = await joinAccount({
          ...input,
          pairing: {
            ...input.pairing,
            openPending: async (account, commitment) => {
              const row = await input.pairing.openPending(account, commitment)
              input.onPending(row)
              return row
            },
          },
          showCode: (value) => {
            input.showCode(value)
            code.resolve(value)
          },
        })
        joined.resolve()
        return result
      },
      approveDevice: (input) =>
        approveDevice({
          ...input,
          pairing: {
            ...input.pairing,
            answerPending: async (id, principal, nonce) => {
              const row = await input.pairing.answerPending(id, principal, nonce)
              input.onAnswered(row)
              return row
            },
          },
          confirmCode: (value) => {
            const answer = input.confirmCode(value)
            code.resolve(value)
            return answer
          },
        }),
    }
    const handlers = new Map<string, Parameters<SyncRpcRegistration["handle"]>[1]>()
    const coordinator = registerSyncRpc(
      {
        handle: (name, handler) => {
          handlers.set(name, handler)
        },
      },
      {
        source: async () => account,
        runtime,
        claims: createSyncRpcClaims(claimsRoot),
        signal: controller.signal,
        pinDir,
        clock,
        syncStatus: async () => ({ state: "never_synced" }),
      },
    )
    cleanup.push(async () => {
      controller.abort()
      await coordinator.dispose()
    })
    return {
      code: code.promise,
      joined: joined.promise,
      clock,
      pinDir,
      call: async (verb: string, data: unknown = {}) => {
        const handler = handlers.get(`omo.memory.sync.${verb}`)
        if (handler === undefined) throw new Error("missing registered handler")
        return handler(data, owner)
      },
    }
  }
  return { server, chain, world, joiner: connect(joining, freshStateDir()), member: connect(world.owner, memberPin) }
}

test("#given two synthetic devices #when registered handlers confirm matching codes #then approval and durable joining complete", async () => {
  const f = await setup()
  expect(await f.joiner.call("enable")).toMatchObject({ kind: "join_required", pairing: { code: null } })
  const pending = f.server.pending()[0]
  if (pending === undefined) throw new Error("no pending row")
  expect(await f.joiner.call("enable")).toMatchObject({ kind: "join_required" })
  expect(f.server.pending()).toHaveLength(1)
  expect(await f.member.call("pending")).toEqual({
    pending: [{ id: pending.id, expiresAt: pending.expires_at, answered: false, revealed: false }],
  })
  await f.member.call("approve", { action: "begin", pendingId: pending.id })
  await f.joiner.clock.advance()
  const joiningCode = await f.joiner.code
  await f.member.clock.advance()
  expect(await f.member.code).toBe(joiningCode)
  expect(await f.member.call("approve", { action: "confirm", pendingId: pending.id, code: joiningCode })).toMatchObject(
    { outcome: { kind: "approved" }, code: null },
  )
  await f.joiner.clock.advance()
  await f.joiner.joined
  expect(await f.joiner.call("status")).toMatchObject({ enable: { kind: "joined" }, sync: { state: "never_synced" } })
  expect((await loadTrustAnchor(f.joiner.pinDir, f.world.account)).ok).toBe(true)
}, 15_000)

test("#given actual pairing codes #when the person submits a different code #then no approval is appended", async () => {
  const f = await setup()
  const before = f.chain.length
  await f.joiner.call("enable")
  const pending = f.server.pending()[0]
  if (pending === undefined) throw new Error("no pending row")
  await f.member.call("approve", { action: "begin", pendingId: pending.id })
  await f.joiner.clock.advance()
  await f.joiner.code
  await f.member.clock.advance()
  const code = await f.member.code
  const wrong = code === "000000" ? "111111" : "000000"
  expect(await f.member.call("approve", { action: "confirm", pendingId: pending.id, code: wrong })).toMatchObject({
    outcome: { kind: "declined" },
  })
  expect(f.chain.length).toBe(before)
}, 15_000)

test("#given an empty keyring without genesis bridge #when registered enable runs #then it asks for a method and offers none", async () => {
  const f = await setup(true)
  expect(await f.joiner.call("enable")).toEqual({ kind: "method_required", methods: [] })
  expect(f.server.pending()).toHaveLength(0)
  expect(await f.joiner.call("status")).toMatchObject({ enable: { kind: "method_required", methods: [] } })
})

test("#given a member device with sync on #when the registered disable handler runs #then the service switch is cleared with a spent confirmation, the device is off locally, a sync session stays idle, and enable turns both back on", async () => {
  const { server, world, member } = await setup()
  const device = `service-${world.owner.principal.id}`
  const session = {
    account: world.account,
    keyring: world.owner.keyring,
    pinDir: member.pinDir,
    spaceId: new Uint8Array(16),
    baseUrl: server.url,
    token: () => server.tokenFor({ ...world.owner.principal }),
  }
  expect(await member.call("enable")).toMatchObject({ kind: "joined" })
  expect(server.enabled(device)).toBe(true)
  expect((await openAccountSession(session)).ok).toBe(true)

  expect(await member.call("disable")).toEqual({ kind: "off" })
  expect(server.enabled(device)).toBe(false)
  expect(server.switches.at(-1)).toMatch(
    new RegExp(`^/v1/devices/${device}/sync \\{"enabled":false,"confirmToken":"[A-Za-z0-9_-]{43}"\\}$`),
  )
  expect(await isDeviceSyncOff(member.pinDir, world.account)).toBe(true)
  expect(await openAccountSession(session)).toEqual({ ok: false, reason: "sync_off" })
  // The trust pin is untouched, so turning sync on again needs no new approval.
  expect((await loadTrustAnchor(member.pinDir, world.account)).ok).toBe(true)

  expect(await member.call("disable")).toEqual({ kind: "off" })
  expect(server.enabled(device)).toBe(false)

  expect(await member.call("enable")).toMatchObject({ kind: "joined" })
  expect(server.enabled(device)).toBe(true)
  expect(await isDeviceSyncOff(member.pinDir, world.account)).toBe(false)
  expect((await openAccountSession(session)).ok).toBe(true)
})
