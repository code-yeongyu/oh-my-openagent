import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { inspect } from "node:util"
import { b64urlDecode } from "../crypto/vendor/sync-format/jcs.ts"
import { disposeRecoveryKeys, publicKeyText } from "./derive.ts"
import { derivePhraseKeys, generateRecoveryPhrase, parseRecoveryPhrase, TypedPhrase } from "./phrase.ts"

type Vector = {
  readonly account: string
  readonly entropy_hex: string
  readonly words: string
  readonly enrollment_nonce: string
}

const fixture: { readonly vectors: ReadonlyArray<Vector> } = JSON.parse(
  readFileSync(resolve(import.meta.dir, "fixtures/phrase-v1.json"), "utf8"),
)
const vector = fixture.vectors.find((candidate) => candidate.entropy_hex.startsWith("1fe2"))
if (vector === undefined) throw new Error("fixture vector missing")

const encodings = (bytes: Uint8Array): ReadonlyArray<string> => {
  const buffer = Buffer.from(bytes)
  return [buffer.toString("base64url"), buffer.toString("base64"), buffer.toString("hex")]
}

const renderings = (value: unknown): ReadonlyArray<string> => [
  String(value),
  `${String(value)}`,
  JSON.stringify(value) ?? "",
  JSON.stringify({ nested: value, list: [value] }),
  Bun.inspect(value),
  Bun.inspect({ nested: value }),
  inspect(value, { depth: 5, showHidden: true }),
  inspect({ nested: value }, { depth: 5 }),
]

const words = vector.words.split(" ")
const wordPattern = new RegExp(`\\b(?:${[...new Set(words)].join("|")})\\b`, "u")

describe("phrase material never reaches a string form, log or error (contract sec 4, review L1)", () => {
  const logged: string[] = []
  const spies: Array<ReturnType<typeof spyOn>> = []
  beforeEach(() => {
    logged.length = 0
    for (const method of ["log", "info", "warn", "error", "debug", "trace"] as const) {
      spies.push(spyOn(console, method).mockImplementation((...args: unknown[]) => void logged.push(Bun.inspect(args))))
    }
  })
  afterEach(() => {
    for (const spy of spies.splice(0)) spy.mockRestore()
  })

  test("phrase, typed words, derived keys, failures and errors: zero canary hits", async () => {
    const nonce = b64urlDecode(vector.enrollment_nonce)
    const phrase = generateRecoveryPhrase((bytes) => bytes.set(Buffer.from(vector.entropy_hex, "hex")))
    const typed = new TypedPhrase(vector.words)
    const parsed = parseRecoveryPhrase(typed)
    if (!parsed.ok) throw new Error("fixture words refused")
    const keys = await derivePhraseKeys(parsed.phrase, vector.account, nonce)
    const canaries = [
      vector.words,
      ...encodings(Buffer.from(vector.entropy_hex, "hex")),
      ...encodings(keys.sealPrivate),
      ...encodings(keys.signSeed),
    ]
    const failures = [
      parseRecoveryPhrase(new TypedPhrase(words.slice(0, 23).join(" "))),
      parseRecoveryPhrase(new TypedPhrase([...words.slice(0, 6), "notaword", ...words.slice(7)].join(" "))),
      parseRecoveryPhrase(new TypedPhrase([...words.slice(0, 23), "sentence"].join(" "))),
    ]
    const thrown: unknown[] = []
    const disposed = generateRecoveryPhrase((bytes) => bytes.set(Buffer.from(vector.entropy_hex, "hex")))
    disposed.dispose()
    try {
      disposed.reveal()
    } catch (error) {
      thrown.push(error)
    }
    await derivePhraseKeys(phrase, vector.account, new Uint8Array(31)).catch((error: unknown) => thrown.push(error))
    expect(thrown).toHaveLength(2)

    const values: unknown[] = [phrase, parsed.phrase, typed, parsed, keys, { ...keys }, ...failures, ...thrown]
    for (const value of values) console.error("phrase flow", value)
    const surfaces = [...values.flatMap(renderings), ...logged].join("\n")

    expect(canaries.filter((canary) => surfaces.includes(canary))).toEqual([])
    expect(surfaces.match(wordPattern)).toBeNull()
    expect(Object.keys(keys)).toEqual([])
    expect(JSON.parse(JSON.stringify(keys))).toBe("[recovery keys]")
    expect(publicKeyText(keys).sealing_public_key.length).toBeGreaterThan(0)
    disposeRecoveryKeys(keys)
    expect(keys.sealPrivate.every((byte) => byte === 0) && keys.signSeed.every((byte) => byte === 0)).toBe(true)
  })

  test("only reveal() yields the words", () => {
    const phrase = generateRecoveryPhrase((bytes) => bytes.set(Buffer.from(vector.entropy_hex, "hex")))
    expect(phrase.reveal().join(" ")).toBe(vector.words)
    expect(`${phrase}`).toBe("[recovery phrase]")
  })
})
