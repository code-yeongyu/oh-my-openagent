import { createHash } from "node:crypto"
import { asciiBytes, concatBytes, sha256 } from "../crypto/vendor/sync-format/jcs.ts"
import { ed25519PublicKey, hkdfSha256 } from "../crypto/vendor/sync-format/keys.ts"
import { BIP39_ENGLISH_ROWS } from "./bip39/english.ts"
import { type RecoveryKeyPairs, x25519PublicKey } from "./derive.ts"

/**
 * The recovery phrase (A3 engine contract sections 2-4): 32 bytes of entropy E, shown as 24 BIP39
 * English words. BIP39 is an encoding only, never a PBKDF2 seed: the keys come from HKDF-SHA-256
 * over E, bound to the account and the enrollment nonce. E and the word indices stay bytes until
 * `reveal()`; every type that holds E, typed words or derived private keys redacts itself.
 */

/** SHA-256 of the vendored BIP39 `english.txt` (2048 words, LF, trailing LF, 13116 bytes). */
export const BIP39_ENGLISH_SHA256 = "2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda"

const PHRASE_SALT_LABEL = "omo-sync/v1/recovery-phrase-salt"
const PHRASE_SEAL_LABEL = "omo-sync/v1/recovery-phrase-seal"
const PHRASE_SIGN_LABEL = "omo-sync/v1/recovery-phrase-sign"

const ENTROPY_BYTES = 32
const WORD_COUNT = 24
const NONCE_BYTES = 32

const loadWordlist = (): ReadonlyArray<string> => {
  const text = `${BIP39_ENGLISH_ROWS.flatMap((row) => row.split(" ")).join("\n")}\n`
  if (createHash("sha256").update(text, "utf8").digest("hex") !== BIP39_ENGLISH_SHA256) {
    throw new Error("the embedded BIP39 English wordlist does not match its pinned SHA-256")
  }
  const words = text.split("\n").slice(0, -1)
  if (words.length !== 2048) throw new Error("the BIP39 English wordlist must hold 2048 words")
  return words
}

const WORDS = loadWordlist()
const INDEX: ReadonlyMap<string, number> = new Map(WORDS.map((word, index) => [word, index]))

const REDACTED_PHRASE = "[recovery phrase]"
const REDACTED_TYPED = "[typed recovery phrase]"
const REDACTED_KEYS = "[recovery keys]"
const NODE_INSPECT = Symbol.for("nodejs.util.inspect.custom")

const checksumByte = (entropy: Uint8Array): number => createHash("sha256").update(entropy).digest()[0] ?? 0

/** 24 big-endian 11-bit indices over E || first byte of SHA-256(E). */
const indicesOf = (entropy: Uint8Array): Uint16Array => {
  const indices = new Uint16Array(WORD_COUNT)
  let accumulator = 0
  let bits = 0
  let next = 0
  const total = ENTROPY_BYTES + 1
  for (let offset = 0; offset < total; offset += 1) {
    accumulator = ((accumulator << 8) | (offset < ENTROPY_BYTES ? (entropy[offset] ?? 0) : checksumByte(entropy))) >>> 0
    bits += 8
    if (bits >= 11) {
      bits -= 11
      indices[next] = (accumulator >>> bits) & 0x7ff
      next += 1
      accumulator &= (1 << bits) - 1
    }
  }
  return indices
}

/** The 33 bytes E || checksum the 24 indices carry. */
const bytesOf = (indices: Uint16Array): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(ENTROPY_BYTES + 1)
  let accumulator = 0
  let bits = 0
  let next = 0
  for (const index of indices) {
    accumulator = ((accumulator << 11) | index) >>> 0
    bits += 11
    while (bits >= 8) {
      bits -= 8
      out[next] = (accumulator >>> bits) & 0xff
      next += 1
    }
    accumulator &= (1 << bits) - 1
  }
  return out
}

let entropyOf: (phrase: RecoveryPhrase) => Uint8Array<ArrayBuffer>
let phraseFrom: (entropy: Uint8Array<ArrayBuffer>) => RecoveryPhrase
let typedTextOf: (typed: TypedPhrase) => string

/**
 * A recovery phrase. E lives in a private field; every string form is "[recovery phrase]". Only the
 * display surface calls `reveal()`; `dispose()` zeroes E, after which the phrase is unusable.
 */
export class RecoveryPhrase {
  readonly #entropy: Uint8Array<ArrayBuffer>
  #disposed = false

  static {
    entropyOf = (phrase) => {
      if (phrase.#disposed) throw new Error("the recovery phrase was disposed")
      return phrase.#entropy
    }
    phraseFrom = (entropy) => new RecoveryPhrase(entropy)
  }

  private constructor(entropy: Uint8Array<ArrayBuffer>) {
    this.#entropy = entropy
  }

  /** The 24 words, for the display surface only. */
  reveal(): ReadonlyArray<string> {
    const indices = indicesOf(entropyOf(this))
    const words = Array.from(indices, (index) => WORDS[index] ?? "")
    indices.fill(0)
    return Object.freeze(words)
  }

  dispose(): void {
    this.#entropy.fill(0)
    this.#disposed = true
  }

  toString(): string {
    return REDACTED_PHRASE
  }

  toJSON(): string {
    return REDACTED_PHRASE
  }

  [Symbol.toPrimitive](): string {
    return REDACTED_PHRASE
  }

  [NODE_INSPECT](): string {
    return REDACTED_PHRASE
  }
}

/** Text a person typed as a recovery phrase, redacted the same way; `parseRecoveryPhrase` consumes it. */
export class TypedPhrase {
  readonly #text: string

  static {
    typedTextOf = (typed) => typed.#text
  }

  constructor(text: string) {
    this.#text = text
  }

  toString(): string {
    return REDACTED_TYPED
  }

  toJSON(): string {
    return REDACTED_TYPED
  }

  [Symbol.toPrimitive](): string {
    return REDACTED_TYPED
  }

  [NODE_INSPECT](): string {
    return REDACTED_TYPED
  }
}

/**
 * A fresh phrase: E is 32 new random bytes for every enrollment. `fillRandom` exists for fixed
 * test vectors; production callers pass nothing.
 */
export const generateRecoveryPhrase = (
  fillRandom: (bytes: Uint8Array<ArrayBuffer>) => void = (bytes) => void crypto.getRandomValues(bytes),
): RecoveryPhrase => {
  const entropy = new Uint8Array(ENTROPY_BYTES)
  fillRandom(entropy)
  return phraseFrom(entropy)
}

export type PhraseParseFailure =
  | { readonly ok: false; readonly reason: "wrong-word-count" }
  /** `position` is 1-based; the word itself is never reported. */
  | { readonly ok: false; readonly reason: "unknown-word"; readonly position: number }
  | { readonly ok: false; readonly reason: "checksum-mismatch" }

export type PhraseParseResult = { readonly ok: true; readonly phrase: RecoveryPhrase } | PhraseParseFailure

/**
 * NFKD, lowercase, trim, and any whitespace run as one separator; then exactly 24 listed words and
 * a matching checksum, all before any derivation can run.
 */
export const parseRecoveryPhrase = (typed: TypedPhrase): PhraseParseResult => {
  const words = typedTextOf(typed).normalize("NFKD").toLowerCase().trim().split(/\s+/u)
  if (words.length !== WORD_COUNT) return { ok: false, reason: "wrong-word-count" }
  const indices = new Uint16Array(WORD_COUNT)
  for (const [offset, word] of words.entries()) {
    const index = INDEX.get(word)
    if (index === undefined) {
      indices.fill(0)
      return { ok: false, reason: "unknown-word", position: offset + 1 }
    }
    indices[offset] = index
  }
  const packed = bytesOf(indices)
  indices.fill(0)
  const entropy = packed.slice(0, ENTROPY_BYTES)
  const checksum = packed[ENTROPY_BYTES]
  packed.fill(0)
  if (checksum !== checksumByte(entropy)) {
    entropy.fill(0)
    return { ok: false, reason: "checksum-mismatch" }
  }
  return { ok: true, phrase: phraseFrom(entropy) }
}

const utf8 = (text: string): Uint8Array<ArrayBuffer> => {
  const encoded = new TextEncoder().encode(text.normalize("NFC"))
  const bytes = new Uint8Array(encoded.length)
  bytes.set(encoded)
  return bytes
}

/** salt = SHA-256("omo-sync/v1/recovery-phrase-salt" || 0x00 || UTF-8(NFC(account)) || enrollment_nonce[32]). */
export const phraseSalt = async (account: string, enrollmentNonce: Uint8Array): Promise<Uint8Array<ArrayBuffer>> => {
  // Async so a wrong-length nonce rejects like every other failure of this Promise (#13330 checker LOW).
  if (enrollmentNonce.length !== NONCE_BYTES) throw new RangeError("an enrollment nonce is exactly 32 bytes")
  return sha256(concatBytes([asciiBytes(PHRASE_SALT_LABEL), Uint8Array.from([0]), utf8(account), enrollmentNonce]))
}

/** Derived phrase keys: private halves are prototype getters, so no enumeration or string form shows them. */
class PhraseKeyPairs implements RecoveryKeyPairs {
  readonly #sealPrivate: Uint8Array<ArrayBuffer>
  readonly #sealPublic: Uint8Array<ArrayBuffer>
  readonly #signSeed: Uint8Array<ArrayBuffer>
  readonly #signPublic: Uint8Array<ArrayBuffer>

  constructor(keys: RecoveryKeyPairs) {
    this.#sealPrivate = keys.sealPrivate
    this.#sealPublic = keys.sealPublic
    this.#signSeed = keys.signSeed
    this.#signPublic = keys.signPublic
  }

  get sealPrivate(): Uint8Array<ArrayBuffer> {
    return this.#sealPrivate
  }

  get sealPublic(): Uint8Array<ArrayBuffer> {
    return this.#sealPublic
  }

  get signSeed(): Uint8Array<ArrayBuffer> {
    return this.#signSeed
  }

  get signPublic(): Uint8Array<ArrayBuffer> {
    return this.#signPublic
  }

  toString(): string {
    return REDACTED_KEYS
  }

  toJSON(): string {
    return REDACTED_KEYS
  }

  [Symbol.toPrimitive](): string {
    return REDACTED_KEYS
  }

  [NODE_INSPECT](): string {
    return REDACTED_KEYS
  }
}

/**
 * seal_priv = HKDF-SHA-256(E, salt, "omo-sync/v1/recovery-phrase-seal", 32) and
 * sign_seed = HKDF-SHA-256(E, salt, "omo-sync/v1/recovery-phrase-sign", 32), with the account-bound
 * salt above. The caller disposes the result with `disposeRecoveryKeys`.
 */
export const derivePhraseKeys = async (
  phrase: RecoveryPhrase,
  account: string,
  enrollmentNonce: Uint8Array,
): Promise<RecoveryKeyPairs> => {
  const salt = await phraseSalt(account, enrollmentNonce)
  const ikm = Uint8Array.from(entropyOf(phrase))
  // Every private key derived so far is overwritten if a later step throws (#13330 checker LOW).
  const derived: Uint8Array[] = []
  try {
    const sealPrivate = await hkdfSha256(ikm, salt, asciiBytes(PHRASE_SEAL_LABEL))
    derived.push(sealPrivate)
    const signSeed = await hkdfSha256(ikm, salt, asciiBytes(PHRASE_SIGN_LABEL))
    derived.push(signSeed)
    return new PhraseKeyPairs({
      sealPrivate,
      sealPublic: x25519PublicKey(sealPrivate),
      signSeed,
      signPublic: await ed25519PublicKey(signSeed),
    })
  } catch (error) {
    for (const key of derived) key.fill(0)
    throw error
  } finally {
    ikm.fill(0)
  }
}
