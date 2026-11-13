import { afterEach, expect, test } from "bun:test"
import { stat } from "node:fs/promises"
import { genesisIntentLocation } from "../genesis/intent-store.ts"
import { deviceKeyring } from "../genesis/vector.test-support.ts"
import { enableSync } from "./enable.ts"
import { createAccountHttp } from "./http.ts"
import { principalOf } from "./join.ts"
import { createPairingHttp } from "./pairing-http.ts"
import { acknowledgePhraseVoid, phraseNoticeStatus } from "./phrase-notice.ts"
import { approveDevice } from "./approve.ts"
import { joinAccount } from "./join.ts"
import { ACCOUNT, fixture } from "./testing/genesis-enable.test-support.ts"
import { openGate, phraseGenesis, scriptedSurface } from "./testing/phrase-enable.test-support.ts"

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close()
})

// A1.1-M1/M4.4: the service is the enforcement. A phrase append it refuses (`phrase_keys_not_accepted`,
// its flag off) maps to phrase_unavailable{service-floor-off}; the intent is retired and the shown phrase
// reads void, never created. A1.1-L3: with the client flag off, an existing phrase chain still joins.
const OFF_AGAIN = [
  '/v1/devices/service-first/sync {"enabled":false}',
  '/v1/account/sync {"enabled":false}',
]

const phraseSetup = async () => {
  const f = await fixture()
  cleanups.push(f.close)
  const place = { pinDir: f.input.pinDir, account: ACCOUNT, principalId: f.keyring.principal().id }
  const genesis = {
    prfSupported: false,
    phraseSupported: true,
    createGenesis: f.input.genesis.createGenesis,
    createPhraseGenesis: phraseGenesis(scriptedSurface().surface),
  }
  const { method: _passkey, ...base } = f.input
  const input = { ...base, genesis, method: "phrase" as const, phraseGate: openGate() }
  const intentExists = () =>
    stat(`${genesisIntentLocation(f.input.pinDir, ACCOUNT, place.principalId)}/intent.json`).then(
      () => true,
      () => false,
    )
  return { f, place, input, intentExists }
}

test("#given the service refuses phrase keys #when a fresh phrase genesis appends #then it answers service-floor-off, retires the intent and the shown phrase reads void", async () => {
  const s = await phraseSetup()
  s.f.server.phrase.accept = false
  expect(await enableSync(s.input)).toEqual({ kind: "phrase_unavailable", reason: "service-floor-off" })
  expect(s.f.entries).toEqual([])
  expect(s.f.server.switches.slice(-2)).toEqual(OFF_AGAIN)
  expect(s.f.server.switches.at(-1)).toBe('/v1/account/sync {"enabled":false}')
  expect(await s.intentExists()).toBe(false)
  expect(await phraseNoticeStatus(s.place)).toEqual({ phraseVoid: { purpose: "genesis" } })
})

test("#given a stored phrase intent whose append was lost #when it resumes after the service stopped accepting phrase keys #then it is refused, retired and void, never created", async () => {
  const s = await phraseSetup()
  await expect(
    enableSync({
      ...s.input,
      chain: {
        ...s.input.chain,
        appendKeys: async () => Promise.reject(new TypeError("synthetic lost connection")),
      },
    }),
  ).rejects.toThrow("synthetic lost connection")
  expect(await s.intentExists()).toBe(true)
  s.f.server.phrase.accept = false
  expect(await enableSync({ ...s.input, phraseGate: { enabled: false, refused: () => undefined } })).toEqual({
    kind: "phrase_unavailable",
    reason: "service-floor-off",
  })
  expect(s.f.entries).toEqual([])
  expect(await s.intentExists()).toBe(false)
  expect(await phraseNoticeStatus(s.place)).toEqual({ phraseVoid: { purpose: "genesis" } })
})

test("#given an account that already holds a phrase chain and a service that no longer accepts NEW phrase keys #when a second device runs with the client flag off #then it still pairs (the approval append re-carries no phrase key and lands), reads status and acknowledges", async () => {
  const s = await phraseSetup()
  expect(await enableSync(s.input)).toEqual({ kind: "joined", created: true })
  s.f.server.phrase.accept = false
  const second = await deviceKeyring(21)
  const token = s.f.server.tokenFor(principalOf(second), "service-second")
  const http = { baseUrl: s.f.server.url, token: () => token }
  const joiner = {
    account: ACCOUNT,
    serviceDeviceId: "service-second",
    serviceOrigin: s.f.server.url,
    keyring: second,
    pinDir: `${s.f.input.pinDir}/second`,
    chain: createAccountHttp(http),
    pairing: createPairingHttp(http),
  }
  expect(await enableSync(joiner)).toEqual({ kind: "join_required" })
  const mailbox = () => {
    let queued = 0
    let waiter: (() => void) | undefined
    return {
      signal() {
        if (waiter === undefined) queued += 1
        else {
          const resolve = waiter
          waiter = undefined
          resolve()
        }
      },
      sleep: async () => {
        if (queued > 0) {
          queued -= 1
          return
        }
        await new Promise<void>((resolve) => {
          waiter = resolve
        })
      },
      now: () => 0,
    }
  }
  const approver = mailbox()
  const joining = mailbox()
  const pending = Promise.withResolvers<string>()
  s.f.server.onWrite = () => {
    approver.signal()
    joining.signal()
    const id = s.f.server.pending()[0]?.id
    if (id !== undefined) pending.resolve(id)
  }
  const joined = joinAccount({ ...joiner, clock: joining, showCode: () => undefined })
  const approved = await approveDevice({
    ...s.input,
    clock: approver,
    pendingId: await pending.promise,
    confirmCode: async () => true,
  })
  expect(approved.kind).toBe("approved")
  expect(await joined).toEqual({ kind: "joined" })
  s.f.server.onWrite = null
  const place = { pinDir: joiner.pinDir, account: ACCOUNT, principalId: second.principal().id }
  expect(await phraseNoticeStatus(place)).toEqual({})
  expect(await acknowledgePhraseVoid({ ...joiner, purpose: "genesis" })).toEqual({ ok: true })
})

test("#given another device's genesis landed while the service refused this phrase append #when enable answers service-floor-off #then only this device's switch goes off and the account keeps syncing", async () => {
  const s = await phraseSetup()
  const live = { head: { seq: 1, link: "x", keyring_link: "x" }, currentEpoch: 1, rotationPending: false, acceptsPhraseKeys: false }
  const result = await enableSync({
    ...s.input,
    chain: {
      ...s.input.chain,
      appendKeys: async () => ({ ok: false, reason: "phrase_keys_not_accepted" }),
      state: async () => live,
    },
  })
  expect(result).toEqual({ kind: "phrase_unavailable", reason: "service-floor-off" })
  expect(s.f.server.switches.at(-1)).toBe('/v1/devices/service-first/sync {"enabled":false}')
  expect(s.f.server.switches.filter((row) => row === '/v1/account/sync {"enabled":false}')).toEqual([])
})
