/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { encryptAuthConfig, decryptAuthConfig } from "./crypto/credential-encryption"
import { createProbeStore } from "./sqlite-store"

let tmpDir: string
let dbPath: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "probe-lab-crypto-"))
  dbPath = join(tmpDir, "lab.db")
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe("credential encryption", () => {
  test("round trip #given plaintext config #when encrypted #then decrypt returns original text", () => {
    const key = createHash("sha256").update("test-key").digest()
    const payload = encryptAuthConfig('{"bearer_token":"tok-1"}', key)
    expect(payload.ciphertext).not.toContain("tok-1")
    expect(decryptAuthConfig(payload, key)).toBe('{"bearer_token":"tok-1"}')
  })

  test("provider store #given auth config #when inserted #then raw db is encrypted and reads decrypt", () => {
    const store = createProbeStore(dbPath)
    const row = store.insertProvider({
      id: "p-enc",
      name: "enc-provider",
      provider_type: "ds2api",
      base_url: "http://localhost:38501",
      auth_type: "bearer_token",
      auth_config: { bearer_token: "tok-secret" },
    })
    expect(JSON.parse(row.auth_config)).toEqual({ bearer_token: "tok-secret" })
    store.close()

    const db = new Database(dbPath)
    const raw = db.query<{ auth_config: string }, []>("SELECT auth_config FROM provider_credentials").get()
    expect(raw?.auth_config).toContain("ciphertext")
    expect(raw?.auth_config).not.toContain("tok-secret")
    db.close()
  })

  test("provider store #given legacy plaintext row #when read #then plaintext fallback remains compatible", () => {
    const store = createProbeStore(dbPath)
    store.insertProvider({
      id: "p-legacy",
      name: "legacy-provider",
      provider_type: "ds2api",
      base_url: "http://localhost:38501",
      auth_type: "bearer_token",
      auth_config: { bearer_token: "tok-old" },
    })
    store.close()

    const db = new Database(dbPath)
    db.run("UPDATE provider_credentials SET auth_config = ?1 WHERE id = 'p-legacy'", ['{"bearer_token":"tok-old"}'])
    db.close()

    const reopened = createProbeStore(dbPath)
    expect(JSON.parse(reopened.getProvider("p-legacy")!.auth_config)).toEqual({ bearer_token: "tok-old" })
    reopened.close()
  })
})
