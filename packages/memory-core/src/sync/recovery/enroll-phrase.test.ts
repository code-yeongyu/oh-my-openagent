import { afterAll, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import type { AccountHttp } from "../account/http.ts"
import { createRejectionCounter } from "../crypto/rejection.ts"
import type { PhraseGate, ServiceFloor } from "../genesis/phrase-gate.ts"
import { genesisIntentLocation } from "../genesis/intent-store.ts"
import { createRecoveryBridge } from "./bridge.ts"
import { enrollPhraseRecoveryKey, pendingPhraseVoid, rotateRecoveryPhrase } from "./enroll-phrase.ts"
import { generateRecoveryPhrase, TypedPhrase } from "./phrase.ts"
import type { RecoveryBridge } from "./ports.ts"
import { removeRecoveryKey } from "./remove.ts"
import { fakeAuthenticator } from "./testing/fake-passkey.test-support.ts"
import {
  createWorld,
  type Device,
  freshStateDir,
  removeWorldStateDirs,
  transportFor,
  verified,
  type World,
} from "./testing/world.test-support.ts"

afterAll(removeWorldStateDirs)

const person = (plan: { readonly cancel?: boolean } = {}) => {
  let shown: ReadonlyArray<string> = []
  const calls = { show: 0 }
  return {
    calls,
    words: () => shown,
    surface: {
      show: async (phrase: { reveal(): ReadonlyArray<string> }) => {
        calls.show += 1
        shown = phrase.reveal()
        return plan.cancel !== true
      },
      confirm: async (positions: ReadonlyArray<number>) =>
        new TypedPhrase(positions.map((position) => shown[position - 1] ?? "").join(" ")),
      enter: async () => new TypedPhrase(shown.join(" ")),
    },
  }
}

const chainOf = (world: World, device: Device, overrides: Partial<AccountHttp> = {}): AccountHttp => ({
  ...transportFor(world, device),
  listEntriesAfter: async () => null,
  state: async () => null,
  ...overrides,
})

const gate = (enabled: boolean, floor: ServiceFloor | (() => Promise<ServiceFloor>)) => {
  const refusals: string[] = []
  const phraseGate: PhraseGate = {
    enabled,
    serviceFloor: typeof floor === "function" ? floor : async () => floor,
    floorTimeoutMs: 25,
    refused: (reason) => void refusals.push(reason),
  }
  return { phraseGate, refusals }
}

const setup = async (plan: { readonly cancel?: boolean } = {}) => {
  const world = await createWorld()
  const who = person(plan)
  const pinDir = freshStateDir()
  const bridge = createRecoveryBridge(fakeAuthenticator(world.provider), world.owner.keyring, {
    phraseSurface: who.surface,
    phraseRandom: { phrase: () => generateRecoveryPhrase((bytes) => void bytes.fill(13)), positions: () => [3, 9, 20] },
  })
  const base = {
    anchor: world.anchor,
    account: world.account,
    keyring: world.owner.keyring,
    bridge,
    chain: chainOf(world, world.owner),
    rejections: createRejectionCounter(),
    pinDir,
    phraseGate: gate(true, "on").phraseGate,
  }
  const place = { pinDir, account: world.account, principalId: world.owner.keyring.principal().id }
  const markers = () =>
    existsSync(`${genesisIntentLocation(pinDir, world.account, place.principalId)}.phrase-enroll`)
  return { world, who, bridge, base, place, markers }
}

// A1.1-M4 for enrollment: a refusal happens before a credential id is drawn, before the marker, before any words.
for (const [label, enabled, floor, why] of [
  ["the flag off", false, "on", "disabled"],
  ["the floor off", true, "off", "service-floor-off"],
  ["the floor unknown", true, "unknown", "service-floor-off"],
  ["a floor port that rejects", true, () => Promise.reject(new Error("synthetic")), "service-floor-off"],
  ["a floor port that never answers", true, () => new Promise<ServiceFloor>(() => undefined), "service-floor-off"],
] as const) {
  for (const op of ["enroll", "rotate"] as const) {
    test(`#given ${label} #when a phrase ${op} is asked for #then it is refused as ${why}: no marker, no words, no append`, async () => {
      const s = await setup()
      const before = (await verified(s.world, s.world.owner)).received.length
      const scripted = gate(enabled, floor)
      const input = { ...s.base, phraseGate: scripted.phraseGate }
      const result =
        op === "enroll"
          ? await enrollPhraseRecoveryKey(input)
          : await rotateRecoveryPhrase({ ...input, oldCredentialId: s.world.firstKey })
      expect(result).toMatchObject({ ok: false, reason: "phrase-unavailable", why })
      if (op === "rotate") expect(result).toMatchObject({ oldStillValid: true })
      expect(s.who.calls.show).toBe(0)
      expect(s.markers()).toBe(false)
      expect((await verified(s.world, s.world.owner)).received.length).toBe(before)
      expect(scripted.refusals).toEqual(why === "disabled" ? [] : ["service-floor-off"])
    })
  }
}

test("#given no phrase gate at all #when a phrase enrollment is asked for #then it is refused as disabled", async () => {
  const s = await setup()
  const { phraseGate: _gate, ...withoutGate } = s.base
  expect(await enrollPhraseRecoveryKey(withoutGate)).toMatchObject({ ok: false, why: "disabled" })
  expect(s.who.calls.show).toBe(0)
})

test("#given an open gate #when a member enrolls a phrase #then a countersigned phrase recovery-key lands and the marker is cleared", async () => {
  const s = await setup()
  const enrolled = await enrollPhraseRecoveryKey(s.base)
  expect(enrolled.ok).toBe(true)
  const record = (await verified(s.world, s.world.owner)).received.at(-1)
  expect(record?.body.kind).toBe("recovery-key")
  expect(record?.body["survivable"]).toBe("phrase")
  expect(record?.body["rp_id"]).toBe("omo-sync/v1/recovery-phrase")
  expect(await pendingPhraseVoid(s.place, await verified(s.world, s.world.owner))).toBeNull()
})

test("#given the person cancels while the words are shown #when enrollment ends #then nothing is appended and no void notice remains", async () => {
  const s = await setup({ cancel: true })
  expect(await enrollPhraseRecoveryKey(s.base)).toEqual({ ok: false, reason: "cancelled" })
  expect(await pendingPhraseVoid(s.place, await verified(s.world, s.world.owner))).toBeNull()
})

test("#given the words were shown and the append is refused (M3) #when the chain is read #then the phrase reads void and the next enrollment must acknowledge first", async () => {
  const s = await setup()
  const refusing = { ...s.base, chain: chainOf(s.world, s.world.owner, { appendKeys: async () => ({ ok: false, reason: "refused" }) }) }
  expect(await enrollPhraseRecoveryKey(refusing)).toEqual({ ok: false, reason: "refused" })
  const state = await verified(s.world, s.world.owner)
  expect(await pendingPhraseVoid(s.place, state)).toEqual({ purpose: "enroll" })
  const shownBefore = s.who.calls.show
  expect(await enrollPhraseRecoveryKey(s.base)).toEqual({
    ok: false,
    reason: "acknowledge-required",
    phraseVoid: { purpose: "enroll" },
  })
  expect(s.who.calls.show).toBe(shownBefore)
})

test("#given the service refuses new phrase keys #when a phrase enrollment appends #then it maps to service-floor-off and the shown phrase reads void", async () => {
  const s = await setup()
  const floorOff = {
    ...s.base,
    chain: chainOf(s.world, s.world.owner, { appendKeys: async () => ({ ok: false, reason: "phrase_keys_not_accepted" }) }),
  }
  expect(await enrollPhraseRecoveryKey(floorOff)).toEqual({ ok: false, reason: "phrase-unavailable", why: "service-floor-off" })
  expect(await pendingPhraseVoid(s.place, await verified(s.world, s.world.owner))).toEqual({ purpose: "enroll" })
})

test("#given a bridge that returns another credential id #when the enrollment is checked #then it is refused as key-mismatch and nothing is appended", async () => {
  const s = await setup()
  const enrollPhrase = s.bridge.enrollPhrase
  if (enrollPhrase === undefined) throw new Error("the reference bridge has phrase members here")
  const lying: RecoveryBridge = {
    ...s.bridge,
    enrollPhrase: async (request) => enrollPhrase({ ...request, credentialId: "AQEBAQEBAQEBAQEBAQEBAQ" }),
  }
  const before = (await verified(s.world, s.world.owner)).received.length
  expect(await enrollPhraseRecoveryKey({ ...s.base, bridge: lying })).toEqual({ ok: false, reason: "key-mismatch" })
  expect((await verified(s.world, s.world.owner)).received.length).toBe(before)
})

test("#given a member rotates to a new phrase #when both the enrollment and the removal land #then the old key is out of the registry and the marker is cleared", async () => {
  const s = await setup()
  const rotated = await rotateRecoveryPhrase({ ...s.base, oldCredentialId: s.world.firstKey })
  expect(rotated.ok).toBe(true)
  const state = await verified(s.world, s.world.owner)
  expect(state.authority?.registry.has(s.world.firstKey)).toBe(false)
  expect([...(state.authority?.registry.values() ?? [])].map((key) => key.survivable)).toEqual(["phrase"])
  expect(await pendingPhraseVoid(s.place, state)).toBeNull()
})

test("#given a phrase key #when it is removed #then the outcome names the phrase kind and no platform signal is attempted", async () => {
  const s = await setup()
  const enrolled = await enrollPhraseRecoveryKey(s.base)
  if (!enrolled.ok) throw new Error("expected the enrollment to land")
  const signals: string[] = []
  const bridge: RecoveryBridge = { ...s.bridge, signalRemoved: async (_rp, id) => (signals.push(id), "signalled") }
  const removed = await removeRecoveryKey({
    anchor: s.world.anchor,
    account: s.world.account,
    rpId: "",
    credentialId: enrolled.credentialId,
    confirmGivingUpRecovery: false,
    keyring: s.world.owner.keyring,
    bridge,
    transport: transportFor(s.world, s.world.owner),
    rejections: createRejectionCounter(),
  })
  expect(removed).toMatchObject({ ok: true, removedKind: "phrase", platformSignal: "unsupported" })
  expect("deleteFromPasskeyManager" in removed).toBe(false)
  expect(signals).toEqual([])
})
