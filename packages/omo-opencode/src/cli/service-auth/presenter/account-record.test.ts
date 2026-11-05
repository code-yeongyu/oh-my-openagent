import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createCredentialStore, credentialId, type SecretApi } from "../keystore"
import type { Credentials } from "../protocol"
import { accountRecordPath, readAccountRecord } from "./account-record"
import { createOmoPresenterAccountAuthority } from "./authority"
import { okpThumbprint, rawEd25519Key } from "./issuer-token"

const API = "https://api.example.test"
const homes: string[] = []
afterAll(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true })
})

function memorySecrets(): SecretApi {
  let value: string | null = null
  return {
    get: async () => value,
    set: async next => {
      value = next.value
    },
    delete: async () => {
      value = null
      return true
    },
  }
}

const credential = (deviceId: string, accountId?: string): Credentials => ({
  accessToken: `at-${deviceId}`,
  accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  refreshToken: `rt-${deviceId}`,
  device: { id: deviceId, name: `device ${deviceId}` },
  signingPrivateKey: `sign-${deviceId}`,
  sealingPrivateKey: `seal-${deviceId}`,
  ...(accountId === undefined ? {} : { accountId }),
})

function machine() {
  const home = mkdtempSync(join(tmpdir(), "omo-account-record-"))
  homes.push(home)
  const store = createCredentialStore(API, { secrets: memorySecrets(), platform: "darwin", home, notice: () => {} })
  return { home, store, record: accountRecordPath(home, credentialId(API)) }
}

// Storage contract: the engine host learns the signed-in account only from this record, never from the keychain.
describe("the CLI credential store keeps the presenter account record", () => {
  test("a sign-in writes the account, and the host authority reads it without touching the keychain", async () => {
    const m = machine()
    await m.store.write(credential("dev-1", "acc-a"))
    expect(readAccountRecord(m.record)?.accountId).toBe("acc-a")
    expect(createOmoPresenterAccountAuthority({ api: API, home: m.home }).hostAccount()).toBe("acc-a")
  })

  test("signing in as another account replaces the record with a new generation", async () => {
    const m = machine()
    await m.store.write(credential("dev-1", "acc-a"))
    const first = readAccountRecord(m.record)
    await m.store.write(credential("dev-2", "acc-b"))
    const second = readAccountRecord(m.record)
    expect(second?.accountId).toBe("acc-b")
    expect(second?.credentialGeneration).not.toBe(first?.credentialGeneration)
  })

  test("clearing the credential removes the record, so the host reads as signed out", async () => {
    const m = machine()
    await m.store.write(credential("dev-1", "acc-a"))
    await m.store.clear()
    expect(readAccountRecord(m.record)).toBeNull()
    expect(createOmoPresenterAccountAuthority({ api: API, home: m.home }).hostAccount()).toBeUndefined()
  })

  test("a credential without an account id leaves no record", async () => {
    const m = machine()
    await m.store.write(credential("dev-1", "acc-a"))
    await m.store.write(credential("dev-9"))
    expect(readAccountRecord(m.record)).toBeNull()
  })
})

// Cross-implementation contract: the presenter key thumbprint is RFC 7638 over the RFC 8037 OKP JWK, so it must equal
// RFC 8037 Appendix A.3's published value for the Appendix A.2 public key.
describe("the presenter key thumbprint", () => {
  test("matches RFC 8037 Appendix A.3 for the key wrapped as an Ed25519 SPKI", async () => {
    const x = Buffer.from("11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo", "base64url")
    const spki = new Uint8Array([...Buffer.from("302a300506032b6570032100", "hex"), ...x])
    const raw = rawEd25519Key(spki)
    expect(raw === undefined ? undefined : await okpThumbprint(raw)).toBe("kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k")
  })

  test("refuses a key that is not a 44-byte Ed25519 SPKI", () => {
    expect(rawEd25519Key(new Uint8Array(44))).toBeUndefined()
    expect(rawEd25519Key(new Uint8Array(32))).toBeUndefined()
  })
})
