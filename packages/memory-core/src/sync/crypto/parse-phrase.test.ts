import { describe, expect, test } from "bun:test"
import {
  phraseRecoveryFor,
  refusedKindPairs,
  wrongLengthCredentialIds,
} from "../recovery/testing/phrase-key.test-support.ts"
import type { KeyringBody } from "./entry.ts"
import { isObject, isPhraseKey, type JsonObject, PHRASE_RECOVERY_RP_ID, parseBody, type RecoveryKey } from "./parse.ts"
import { ACCOUNT, record } from "./testing/sync-v1.test-support.ts"

const objectAt = (value: JsonObject, key: string): JsonObject => {
  const field = value[key]
  if (!isObject(field)) throw new Error(`fixture field ${key} is not an object`)
  return field
}

const genesisWith = (key: JsonObject): KeyringBody => {
  const body = record("genesis").body
  return { ...body, bootstrap: { ...objectAt(body, "bootstrap"), recovery_key: key } }
}

const recoveryKeyWith = (key: JsonObject): KeyringBody => ({ ...record("recovery_key").body, ...key })

const forkStateWith = (key: JsonObject): KeyringBody => {
  const body = record("fork_resolution").body
  const state = objectAt(body, "state")
  const keys = state["recovery_keys"]
  if (!Array.isArray(keys)) throw new Error("fixture fork state has no recovery keys")
  return { ...body, state: { ...state, recovery_keys: [...keys, key] } }
}

const recoveryKeysOf = (body: KeyringBody): ReadonlyArray<RecoveryKey> => {
  const parsed = parseBody(body)
  switch (parsed?.kind) {
    case "genesis":
      return [parsed.recoveryKey]
    case "recovery-key":
      return [parsed.key]
    case "fork-resolution":
      return parsed.recoveryKeys
    default:
      throw new Error(`fixture body did not parse: ${parsed?.kind ?? "null"}`)
  }
}

const sites = [
  ["genesis bootstrap", genesisWith],
  ["recovery-key record", recoveryKeyWith],
  ["fork-resolution state", forkStateWith],
] as const

describe("parseBody: the survivable kind union (contract sec 1)", () => {
  test("the phrase marker is the service contract's value", () => {
    expect(PHRASE_RECOVERY_RP_ID).toBe("omo-sync/v1/recovery-phrase")
  })

  test.each(sites)("%s: a phrase key parses as the phrase kind", async (_site, place) => {
    const { key } = await phraseRecoveryFor(ACCOUNT)
    const parsed = recoveryKeysOf(place(key))
    const phrase = parsed.find((candidate) => candidate.credential_id === key.credential_id)
    expect(phrase).toEqual(key)
    expect(phrase !== undefined && isPhraseKey(phrase)).toBe(true)
    expect(parsed.filter(isPhraseKey)).toHaveLength(1)
  })

  test.each(sites)("%s: the fixture passkey keys still parse unchanged", (_site, place) => {
    const passkey = objectAt(objectAt(record("genesis").body, "bootstrap"), "recovery_key")
    const parsed = recoveryKeysOf(place({ ...passkey, credential_id: "cGFzc2tleS1yZWdyZXNzaW9u" }))
    expect(parsed.some(isPhraseKey)).toBe(false)
    expect(parsed.find((key) => key.credential_id === "cGFzc2tleS1yZWdyZXNzaW9u")?.survivable).toBe("synced")
  })

  for (const [site, place] of sites) {
    test.each(refusedKindPairs)(`${site}: refuses %s`, async (_pair, override) => {
      const { key } = await phraseRecoveryFor(ACCOUNT)
      expect(parseBody(place({ ...key, ...override }))).toBeNull()
    })

    test.each(wrongLengthCredentialIds)(`${site}: refuses a %i-byte phrase credential_id`, async (_length, id) => {
      const { key } = await phraseRecoveryFor(ACCOUNT)
      expect(parseBody(place({ ...key, credential_id: id }))).toBeNull()
    })
  }
})
