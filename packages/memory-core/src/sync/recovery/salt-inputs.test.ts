import { describe, expect, test } from "bun:test"
import type { KeyringEntry } from "../crypto/entry.ts"
import { ACCOUNT, record } from "../crypto/testing/sync-v1.test-support.ts"
import { b64urlEncode } from "../crypto/vendor/sync-format/jcs.ts"
import type { RecoveryTransport } from "./ports.ts"
import { MAX_RECOVERY_KEYS, servedSaltInputs } from "./salt-inputs.ts"
import { phraseRecoveryFor } from "./testing/phrase-key.test-support.ts"

const serving = (rows: ReadonlyArray<KeyringEntry>): RecoveryTransport => ({
  listKeys: async () => rows,
  listEntries: async () => null,
  listRecoveryWraps: async () => null,
  appendKeys: async () => ({ ok: false, reason: "refused" }),
  recoveryJoin: async () => ({ ok: false, reason: "refused" }),
})

const recoveryRow = (key: Readonly<Record<string, string>>): KeyringEntry => {
  const row = record("recovery_key")
  return { ...row, body: { ...row.body, ...key } }
}

describe("servedSaltInputs: PRF salt inputs exclude phrase records (contract sec 0 delta a, F12)", () => {
  test("a served phrase recovery-key row never becomes a PRF salt input", async () => {
    const { key } = await phraseRecoveryFor(ACCOUNT)
    const served = await servedSaltInputs(serving([record("genesis"), recoveryRow(key)]))
    expect(served.ok).toBe(true)
    if (!served.ok) return
    expect(served.salts.map((salt) => salt.credentialId)).not.toContain(key.credential_id)
    expect(served.salts).toHaveLength(1)
  })

  test("a row in the reserved omo-sync/ rp namespace is not offered to the authenticator either", async () => {
    const { key } = await phraseRecoveryFor(ACCOUNT)
    const served = await servedSaltInputs(serving([record("genesis"), recoveryRow({ ...key, survivable: "synced" })]))
    expect(served.ok).toBe(true)
    if (!served.ok) return
    expect(served.salts.map((salt) => salt.credentialId)).not.toContain(key.credential_id)
    expect(served.salts).toHaveLength(1)
  })

  test("phrase rows still count toward MAX_RECOVERY_KEYS across both kinds", async () => {
    const { key } = await phraseRecoveryFor(ACCOUNT)
    const passkeys = Array.from({ length: MAX_RECOVERY_KEYS }, (_, index) =>
      recoveryRow({ credential_id: b64urlEncode(new Uint8Array(16).fill(index + 40)) }),
    )
    expect(await servedSaltInputs(serving([...passkeys, recoveryRow(key)]))).toEqual({
      ok: false,
      reason: "too-many-recovery-keys",
    })
  })
})
