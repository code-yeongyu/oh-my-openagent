import { afterAll, expect, test } from "bun:test"
import { createRejectionCounter } from "../crypto/rejection.ts"
import { createRecoveryBridge } from "./bridge.ts"
import { enrollPhraseRecoveryKey } from "./enroll-phrase.ts"
import { generateRecoveryPhrase, TypedPhrase } from "./phrase.ts"
import { recoverOnFreshDevice } from "./recover.ts"
import { fakeAuthenticator } from "./testing/fake-passkey.test-support.ts"
import {
  createWorld,
  freshStateDir,
  newDevice,
  RP_ID,
  removeWorldStateDirs,
  transportFor,
  verified,
} from "./testing/world.test-support.ts"

afterAll(removeWorldStateDirs)

const enrolledWorld = async () => {
  const world = await createWorld()
  let shown: ReadonlyArray<string> = []
  const bridge = createRecoveryBridge(fakeAuthenticator(world.provider), world.owner.keyring, {
    phraseSurface: {
      show: async (phrase) => {
        shown = phrase.reveal()
        return true
      },
      confirm: async (positions) => new TypedPhrase(positions.map((p) => shown[p - 1] ?? "").join(" ")),
      enter: async () => null,
    },
    phraseRandom: { phrase: () => generateRecoveryPhrase((bytes) => void bytes.fill(17)), positions: () => [1, 2, 3] },
  })
  const enrolled = await enrollPhraseRecoveryKey({
    anchor: world.anchor,
    account: world.account,
    keyring: world.owner.keyring,
    bridge,
    chain: { ...transportFor(world, world.owner), listEntriesAfter: async () => null, state: async () => null },
    rejections: createRejectionCounter(),
    pinDir: freshStateDir(),
    phraseGate: { enabled: true, serviceFloor: async () => "on", refused: () => undefined },
  })
  if (!enrolled.ok) throw new Error("expected the phrase enrollment to land")
  return { world, words: shown, credentialId: enrolled.credentialId }
}

const recoverWith = async (world: Awaited<ReturnType<typeof enrolledWorld>>["world"], typed: ReadonlyArray<string>) => {
  const fresh = await newDevice()
  const entries: string[] = []
  const bridge = createRecoveryBridge(fakeAuthenticator(world.provider), fresh.keyring, {
    phraseSurface: {
      show: async () => false,
      confirm: async () => null,
      enter: async (retry) => {
        entries.push(retry === null ? "first" : retry.reason)
        return entries.length > 3 ? null : new TypedPhrase(typed.join(" "))
      },
    },
  })
  const outcome = await recoverOnFreshDevice({
    account: world.account,
    rpId: RP_ID,
    keyring: fresh.keyring,
    bridge,
    transport: transportFor(world, fresh),
    rejections: createRejectionCounter(),
    stateDir: freshStateDir(),
    method: "phrase",
  })
  return { outcome, entries, fresh }
}

test("#given an enrolled phrase #when a fresh device types it #then recovery runs the unchanged anchored path and the device joins", async () => {
  const s = await enrolledWorld()
  const { outcome } = await recoverWith(s.world, s.words)
  expect(outcome).toMatchObject({ ok: true, credentialId: s.credentialId })
  const joined = (await verified(s.world, s.world.owner)).received.find((record) => record.body.kind === "recovery-join")
  expect(joined?.body["credential_id"]).toBe(s.credentialId)
})

test("#given a different but valid phrase #when it is typed #then nothing matches and it refuses as history-incomplete without a join", async () => {
  const s = await enrolledWorld()
  const other = generateRecoveryPhrase((bytes) => void bytes.fill(99))
  const { outcome } = await recoverWith(s.world, other.reveal())
  other.dispose()
  expect(outcome).toEqual({ ok: false, reason: "history-incomplete" })
  expect((await verified(s.world, s.world.owner)).received.some((record) => record.body.kind === "recovery-join")).toBe(false)
})

test("#given a mistyped phrase #when it is entered #then the surface is asked again with the checksum reason and no key is derived", async () => {
  const s = await enrolledWorld()
  const typo = [...s.words.slice(0, 23), s.words[0] === "zoo" ? "abandon" : "zoo"]
  const { outcome, entries } = await recoverWith(s.world, typo)
  expect(outcome).toEqual({ ok: false, reason: "cancelled" })
  expect(entries).toEqual(["first", "checksum-mismatch", "checksum-mismatch", "checksum-mismatch"])
})

test("#given an account whose only enrolled key is a passkey #when phrase recovery is asked for #then there is no phrase key to recover with", async () => {
  const world = await createWorld()
  const { outcome } = await recoverWith(world, [])
  expect(outcome).toEqual({ ok: false, reason: "no-recovery-key" })
})
