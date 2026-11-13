import { afterEach, expect, test } from "bun:test"
import { genesisIntentLocation, withGenesisLock } from "../genesis/intent-store.ts"
import { writePhraseGenesisMarker } from "../genesis/phrase-marker.ts"
import { enableSync } from "./enable.ts"
import { acknowledgePhraseVoid, phraseNoticeStatus } from "./phrase-notice.ts"
import { ACCOUNT, fixture } from "./testing/genesis-enable.test-support.ts"
import {
  competingGenesisEntry,
  phraseGenesis,
  phraseMarkerExists,
  openGate,
  scriptedSurface,
  type SurfacePlan,
} from "./testing/phrase-enable.test-support.ts"
import { stat } from "node:fs/promises"

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close()
})

const setup = async (plan: SurfacePlan = {}, options: { readonly prf?: boolean; readonly onConfirm?: () => void | Promise<void> } = {}) => {
  const f = await fixture()
  cleanups.push(f.close)
  const person = scriptedSurface(plan, { ...(options.onConfirm === undefined ? {} : { onConfirm: options.onConfirm }) })
  const genesis = {
    ...f.input.genesis,
    prfSupported: options.prf ?? false,
    phraseSupported: true,
    createPhraseGenesis: phraseGenesis(person.surface),
  }
  const place = { pinDir: f.input.pinDir, account: ACCOUNT, principalId: f.keyring.principal().id }
  const intentExists = async () =>
    stat(`${genesisIntentLocation(f.input.pinDir, ACCOUNT, f.keyring.principal().id)}/intent.json`).then(
      () => true,
      () => false,
    )
  const input = { ...f.input, phraseGate: openGate() }
  return { f, input, person, genesis, place, intentExists, marker: () => phraseMarkerExists(f.input.pinDir, place.principalId) }
}

test("#given an empty account and no method #when enable runs #then it answers method_required with the offered methods and writes nothing", async () => {
  for (const prf of [false, true]) {
    const s = await setup({}, { prf })
    const { method: _passkey, ...withoutMethod } = s.input
    const outcome = await enableSync({ ...withoutMethod, genesis: s.genesis })
    expect(outcome).toEqual({ kind: "method_required", methods: prf ? ["passkey", "phrase"] : ["phrase"] })
    expect(s.f.server.switches).toEqual([])
    expect(s.f.entries).toEqual([])
    expect(await s.marker()).toBe(false)
    expect(s.person.calls.show + s.f.ceremonies()).toBe(0)
  }
})

test("#given no PRF #when the passkey method is asked for #then it answers passkey_unavailable and writes nothing", async () => {
  const s = await setup()
  expect(await enableSync({ ...s.input, genesis: s.genesis, method: "passkey" })).toEqual({ kind: "passkey_unavailable" })
  expect(s.f.server.switches).toEqual([])
  expect(s.f.ceremonies()).toBe(0)
})

test("#given no phrase surface in this process #when the phrase method is asked for #then it answers phrase_unavailable and writes nothing", async () => {
  const s = await setup()
  const genesis = { prfSupported: false, createGenesis: s.genesis.createGenesis }
  expect(await enableSync({ ...s.input, genesis, method: "phrase" })).toEqual({ kind: "phrase_unavailable", reason: "no-surface" })
  expect(s.f.server.switches).toEqual([])
  expect(await s.marker()).toBe(false)
})

test("#given the phrase method #when the person confirms #then nothing is switched before confirmation and a phrase recovery key is committed", async () => {
  let switchesAtConfirm: ReadonlyArray<string> | undefined
  const s = await setup({}, { onConfirm: () => void (switchesAtConfirm = [...s.f.server.switches]) })
  const ceremonies: string[] = []
  const outcome = await enableSync({ ...s.input, genesis: s.genesis, method: "phrase", onCeremony: (method) => void ceremonies.push(method) })
  expect(outcome).toEqual({ kind: "joined", created: true })
  expect(ceremonies).toEqual(["phrase"])
  expect(switchesAtConfirm).toEqual([])
  expect(s.f.server.switches).toEqual(['/v1/account/sync {"enabled":true}', '/v1/devices/service-first/sync {"enabled":true}'])
  const first = s.f.entries[0]
  const body = first?.kind === "keyring" ? first.body : undefined
  expect(body?.kind).toBe("genesis")
  expect(JSON.stringify(body)).toContain('"survivable":"phrase"')
  expect(JSON.stringify(body)).toContain('"rp_id":"omo-sync/v1/recovery-phrase"')
  expect(await s.marker()).toBe(false)
  expect(await s.intentExists()).toBe(false)
})

for (const plan of [{ show: false }, { answers: ["cancel"] }, { answers: ["wrong", "cancel"] }] satisfies SurfacePlan[]) {
  test(`#given the phrase method #when the person cancels (${JSON.stringify(plan)}) #then switches, intent, chain and marker are untouched`, async () => {
    const s = await setup(plan)
    expect(await enableSync({ ...s.input, genesis: s.genesis, method: "phrase" })).toEqual({ kind: "cancelled" })
    expect(s.f.server.switches).toEqual([])
    expect(s.f.entries).toEqual([])
    expect(await s.intentExists()).toBe(false)
    expect(await s.marker()).toBe(false)
  })
}

test("#given a wrong 3-word answer #when the person retries #then it is asked again and commits only after it matches", async () => {
  const s = await setup({ answers: ["wrong", "wrong", "right"] })
  expect(await enableSync({ ...s.input, genesis: s.genesis, method: "phrase" })).toEqual({ kind: "joined", created: true })
  expect(s.person.calls.confirm).toBe(3)
})

test("#given an account that already has a chain #when the phrase method is asked for #then the device joins and no phrase is ever shown", async () => {
  const s = await setup()
  s.f.entries.push(await competingGenesisEntry())
  expect(await enableSync({ ...s.input, genesis: s.genesis, method: "phrase" })).toEqual({ kind: "join_required" })
  expect(s.person.calls.show).toBe(0)
})

test("#given another device wins the genesis race while words are shown #when the append loses #then the marker stays and the phrase is reported void until acknowledged", async () => {
  const winner = await competingGenesisEntry()
  const s = await setup({}, { onConfirm: () => void s.f.entries.push(winner) })
  expect(await enableSync({ ...s.input, genesis: s.genesis, method: "phrase" })).toEqual({
    kind: "join_required",
    phraseVoid: { purpose: "genesis" },
  })
  expect(await s.marker()).toBe(true)
  expect(await phraseNoticeStatus(s.place)).toEqual({ phraseVoid: { purpose: "genesis" } })
  expect(await phraseNoticeStatus(s.place)).toEqual({ phraseVoid: { purpose: "genesis" } })
  expect(await acknowledgePhraseVoid({ ...s.input, purpose: "genesis" })).toEqual({ ok: true })
  expect(await phraseNoticeStatus(s.place)).toEqual({})
})

for (const method of ["phrase", "passkey"] as const) {
  test(`#given an undelivered genesis phrase-void notice #when a ${method} ceremony is asked for #then it answers acknowledge_required and calls no bridge`, async () => {
    const s = await setup({}, { prf: true })
    await writePhraseGenesisMarker(s.place, { version: 1, account: ACCOUNT, startedAt: 1 })
    expect(await enableSync({ ...s.input, genesis: s.genesis, method })).toEqual({
      kind: "acknowledge_required",
      phraseVoid: { purpose: "genesis" },
    })
    expect(s.person.calls.show + s.f.ceremonies()).toBe(0)
    expect(s.f.server.switches).toEqual([])
    expect(await acknowledgePhraseVoid({ ...s.input, purpose: "genesis" })).toEqual({ ok: true })
    expect((await enableSync({ ...s.input, genesis: s.genesis, method })).kind).toBe("joined")
  })
}

test("#given a phrase marker that appears during a passkey genesis #when the passkey genesis is created #then the phrase marker is not deleted (only a phrase genesis clears it)", async () => {
  const s = await setup({}, { prf: true })
  const genesis = {
    ...s.genesis,
    createGenesis: async (...args: Parameters<typeof s.genesis.createGenesis>) => {
      await writePhraseGenesisMarker(s.place, { version: 1, account: ACCOUNT, startedAt: 2 })
      return s.genesis.createGenesis(...args)
    },
  }
  expect(await enableSync({ ...s.input, genesis, method: "passkey" })).toEqual({ kind: "joined", created: true })
  expect(await s.marker()).toBe(true)
})

test("#given another live process holds the genesis lock #when enable runs #then it answers in_progress and shows nothing", async () => {
  const s = await setup()
  const held = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const holder = withGenesisLock(s.f.input, async () => {
    held.resolve()
    await release.promise
  })
  await held.promise
  expect(await enableSync({ ...s.input, genesis: s.genesis, method: "phrase" })).toEqual({ kind: "in_progress" })
  expect(await phraseNoticeStatus(s.place)).toEqual({ inProgress: true })
  release.resolve()
  await holder
  expect(s.person.calls.show).toBe(0)
})

test("#given the bridge throws after the ceremony started #when enable fails #then the marker is kept and the phrase reads void once the lock is free", async () => {
  const s = await setup()
  const genesis = {
    ...s.genesis,
    createPhraseGenesis: async () => {
      throw new Error("synthetic failure after the words were shown")
    },
  }
  await expect(enableSync({ ...s.input, method: "phrase", genesis })).rejects.toThrow("synthetic failure")
  expect(await s.marker()).toBe(true)
  expect(await phraseNoticeStatus(s.place)).toEqual({ phraseVoid: { purpose: "genesis" } })
})
