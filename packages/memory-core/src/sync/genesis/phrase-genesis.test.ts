import { describe, expect, test } from "bun:test"
import { jcsBytes, sha256B64 } from "../crypto/vendor/sync-format/jcs.ts"
import { signFramed } from "../crypto/vendor/sync-format/keys.ts"
import {
  phraseRecoveryFor,
  refusedKindPairs,
  wrongLengthCredentialIds,
} from "../recovery/testing/phrase-key.test-support.ts"
import { buildGenesis } from "./build.ts"
import { parseGenesisIntent } from "./intent-verify.ts"
import { prepareGenesis } from "./prepare.ts"
import type { GenesisBootstrap } from "./types.ts"
import { validateBootstrap } from "./validate.ts"
import { ACCOUNT, deviceKeyring, vector, walk } from "./vector.test-support.ts"
import { deterministicSeal } from "./seal.test-support.ts"

const json = <T>(value: unknown): T => JSON.parse(JSON.stringify(value))

const phraseGenesis = async () => {
  const keyring = await deviceKeyring()
  const phrase = await phraseRecoveryFor(ACCOUNT)
  const bootstrap: GenesisBootstrap = { ...(await vector()).bootstrap, recovery_key: phrase.key }
  const prepared = await prepareGenesis(bootstrap, {
    seal: deterministicSeal,
    countersign: (payload) => signFramed("omo-sync/v1/recovery-countersign", payload, phrase.keys.signSeed),
  })
  const built = await buildGenesis(ACCOUNT, keyring, prepared)
  return { keyring, phrase, bootstrap, built }
}

const intentJson = (request: unknown, keyring: Awaited<ReturnType<typeof deviceKeyring>>, digest: string): string =>
  JSON.stringify({
    version: 1,
    account: ACCOUNT,
    serviceOrigin: "https://sync.example.test",
    serviceDeviceId: "service-device",
    syncPrincipal: {
      ...keyring.principal(),
      sealing_public_key: keyring.publicKeys().sealing,
      signing_public_key: keyring.publicKeys().signing,
    },
    genesisDigest: digest,
    request,
  })

const expected = (keyring: Awaited<ReturnType<typeof deviceKeyring>>) => ({
  account: ACCOUNT,
  serviceOrigin: "https://sync.example.test",
  serviceDeviceId: "service-device",
  keyring,
})

describe("phrase genesis through the unchanged prepare/build path (contract sec 1)", () => {
  test("validateBootstrap accepts a phrase key; the walk keeps it as the phrase kind", async () => {
    const { keyring, phrase, built } = await phraseGenesis()
    const outcome = await walk(built.request, keyring)
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.state.authority?.registry.get(phrase.key.credential_id)).toEqual(phrase.key)
  })

  test.each(refusedKindPairs)("validateBootstrap refuses %s", async (_pair, override) => {
    const { bootstrap } = await phraseGenesis()
    const changed = { ...bootstrap, recovery_key: { ...bootstrap.recovery_key, ...override } }
    await expect(validateBootstrap(json<GenesisBootstrap>(changed))).rejects.toMatchObject({ reason: "bad_bootstrap" })
  })

  test.each(wrongLengthCredentialIds)("validateBootstrap refuses a %i-byte phrase credential_id", async (_n, id) => {
    const { bootstrap } = await phraseGenesis()
    const changed = { ...bootstrap, recovery_key: { ...bootstrap.recovery_key, credential_id: id } }
    await expect(validateBootstrap(changed)).rejects.toMatchObject({ reason: "bad_bootstrap" })
  })

  test("a stored phrase intent resumes instead of failing as corrupt_intent", async () => {
    const { keyring, built } = await phraseGenesis()
    const digest = await sha256B64(jcsBytes(built.request.record))
    const intent = await parseGenesisIntent(intentJson(built.request, keyring, digest), expected(keyring))
    expect(intent.request.record.bootstrap.recovery_key.survivable).toBe("phrase")
  })

  test.each([
    ...refusedKindPairs,
    ...wrongLengthCredentialIds.map(([n, id]) => [`${n}-byte id`, { credential_id: id }] as const),
  ])("the intent schema refuses %s as corrupt_intent", async (_pair, override) => {
    const { keyring, built } = await phraseGenesis()
    const record = built.request.record
    const bootstrap = { ...record.bootstrap, recovery_key: { ...record.bootstrap.recovery_key, ...override } }
    const request = { ...built.request, record: { ...record, bootstrap } }
    await expect(
      parseGenesisIntent(intentJson(request, keyring, await sha256B64(jcsBytes(record))), expected(keyring)),
    ).rejects.toMatchObject({ reason: "corrupt_intent" })
  })
})
