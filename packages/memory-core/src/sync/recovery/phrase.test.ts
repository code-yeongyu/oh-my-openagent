import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { b64urlDecode, b64urlEncode } from "../crypto/vendor/sync-format/jcs.ts"
import { BIP39_ENGLISH_ROWS } from "./bip39/english.ts"
import { publicKeyText } from "./derive.ts"
import {
  BIP39_ENGLISH_SHA256,
  derivePhraseKeys,
  generateRecoveryPhrase,
  parseRecoveryPhrase,
  phraseSalt,
  type RecoveryPhrase,
  TypedPhrase,
} from "./phrase.ts"

type Vector = {
  readonly name: string
  readonly account: string
  readonly entropy_hex: string
  readonly words: string
  readonly enrollment_nonce: string
  readonly salt: string
  readonly sealing_public_key: string
  readonly signing_public_key: string
}
type Input = {
  readonly name: string
  readonly input: string
  readonly entropy_hex?: string
  readonly error?: string
  readonly position?: number
}
type PhraseFixture = {
  readonly wordlist: { readonly sha256: string }
  readonly cross_account_negative: readonly [string, string]
  readonly vectors: ReadonlyArray<Vector>
  readonly inputs: ReadonlyArray<Input>
}

const here = (path: string): string => resolve(import.meta.dir, path)
const fixtureBytes = readFileSync(here("fixtures/phrase-v1.json"))
const fixture: PhraseFixture = JSON.parse(fixtureBytes.toString("utf8"))

/** The contract (section 3, r3) pins this file; any byte change is a contract change. */
const PHRASE_V1_SHA256 = "474cb3779f849b3af5f16aaaf61605f6f444a99fc60f4c5f8cedb35548ad8d98"

const fromEntropy = (hex: string): RecoveryPhrase =>
  generateRecoveryPhrase((bytes) => bytes.set(Buffer.from(hex, "hex")))

const parsed = (text: string): RecoveryPhrase => {
  const result = parseRecoveryPhrase(new TypedPhrase(text))
  if (!result.ok) throw new Error(`fixture input refused: ${result.reason}`)
  return result.phrase
}

const vectorNamed = (name: string): Vector => {
  const found = fixture.vectors.find((vector) => vector.name === name)
  if (found === undefined) throw new Error(`no vector ${name}`)
  return found
}

const derived = async (vector: Vector) =>
  publicKeyText(await derivePhraseKeys(parsed(vector.words), vector.account, b64urlDecode(vector.enrollment_nonce)))

describe("the BIP39 English wordlist", () => {
  test("the vendored english.txt and the embedded rows are the same 13116 bytes with the pinned sha256", () => {
    const file = readFileSync(here("bip39/english.txt"))
    const embedded = Buffer.from(`${BIP39_ENGLISH_ROWS.flatMap((row) => row.split(" ")).join("\n")}\n`, "utf8")
    expect(file.length).toBe(13116)
    expect(embedded.equals(file)).toBe(true)
    expect(createHash("sha256").update(file).digest("hex")).toBe(BIP39_ENGLISH_SHA256)
    expect(BIP39_ENGLISH_SHA256).toBe("2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda")
    expect(fixture.wordlist.sha256).toBe(BIP39_ENGLISH_SHA256)
  })

  test("known answer: 32 zero bytes encode to abandon x23 then art", () => {
    expect(fromEntropy("00".repeat(32)).reveal()).toEqual([...Array<string>(23).fill("abandon"), "art"])
  })
})

describe("phrase-v1.json: the TypeScript implementation reproduces the independent oracle", () => {
  test("the committed vector file is byte-identical to the pinned oracle output", () => {
    expect(createHash("sha256").update(fixtureBytes).digest("hex")).toBe(PHRASE_V1_SHA256)
    expect(fixture.vectors.length).toBeGreaterThanOrEqual(7)
  })

  test.each(fixture.vectors.map((vector) => [vector.name, vector] as const))(
    "%s: encoding, decoding, salt and both public keys",
    async (_name, vector) => {
      expect(fromEntropy(vector.entropy_hex).reveal().join(" ")).toBe(vector.words)
      expect(parsed(vector.words).reveal().join(" ")).toBe(vector.words)
      expect(b64urlEncode(await phraseSalt(vector.account, b64urlDecode(vector.enrollment_nonce)))).toBe(vector.salt)
      expect(await derived(vector)).toEqual({
        sealing_public_key: vector.sealing_public_key,
        signing_public_key: vector.signing_public_key,
      })
    },
  )

  test("cross-account negative: the same E and nonce under another account give other keys", async () => {
    const [a, b] = fixture.cross_account_negative.map(vectorNamed)
    if (a === undefined || b === undefined) throw new Error("negative pair missing")
    expect(a.entropy_hex).toBe(b.entropy_hex)
    expect(a.enrollment_nonce).toBe(b.enrollment_nonce)
    expect(a.account).not.toBe(b.account)
    const [keysA, keysB] = [await derived(a), await derived(b)]
    expect(keysA.sealing_public_key).not.toBe(keysB.sealing_public_key)
    expect(keysA.signing_public_key).not.toBe(keysB.signing_public_key)
  })

  test("the account is NFC-normalised: NFD and NFC spellings derive the same salt", async () => {
    const vector = vectorNamed("non-ascii-account-nfd-input")
    expect(vector.account.normalize("NFC")).not.toBe(vector.account)
    const nonce = b64urlDecode(vector.enrollment_nonce)
    const nfc = b64urlEncode(await phraseSalt(vector.account.normalize("NFC"), nonce))
    expect(nfc).toBe(vector.salt)
  })

  test.each(fixture.inputs.map((input) => [input.name, input] as const))("input %s", (_name, input) => {
    const result = parseRecoveryPhrase(new TypedPhrase(input.input))
    if (input.entropy_hex !== undefined) {
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.phrase.reveal()).toEqual(fromEntropy(input.entropy_hex).reveal())
      return
    }
    const failure: unknown = result
    expect(failure).toEqual(
      input.position === undefined
        ? { ok: false, reason: input.error }
        : { ok: false, reason: input.error, position: input.position },
    )
  })
})

describe("phrase lifecycle", () => {
  test("a generated phrase is fresh 24 listed words and round-trips through parsing", () => {
    const words = new Set(BIP39_ENGLISH_ROWS.flatMap((row) => row.split(" ")))
    const first = generateRecoveryPhrase().reveal()
    const second = generateRecoveryPhrase().reveal()
    expect(first).toHaveLength(24)
    expect(first.every((word) => words.has(word))).toBe(true)
    expect(first).not.toEqual(second)
    expect(parsed(first.join(" ")).reveal()).toEqual(first)
  })

  test("dispose zeroes E: a disposed phrase can neither reveal nor derive", async () => {
    const phrase = fromEntropy("7f".repeat(32))
    phrase.dispose()
    expect(() => phrase.reveal()).toThrow("disposed")
    await expect(derivePhraseKeys(phrase, "account", new Uint8Array(32))).rejects.toThrow("disposed")
  })

  test("an enrollment nonce must be exactly 32 bytes", async () => {
    const phrase = fromEntropy("00".repeat(32))
    for (const length of [0, 16, 31, 33]) {
      await expect(derivePhraseKeys(phrase, "account", new Uint8Array(length))).rejects.toThrow(RangeError)
    }
  })
})
