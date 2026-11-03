import { describe, expect, it } from "bun:test"
import { decodeRecallTermStore, encodeRecallTermStore, type RecallTermStore } from "./bm25-store"

const KEY_A = "a".repeat(40)
const KEY_B = "0123456789abcdef0123456789abcdef01234567"

function store(documents: RecallTermStore["documents"] = sampleDocuments()): RecallTermStore {
  return { fingerprint: "tokenizer-v1", terms: ["deploy", "롤백", "東"], documents }
}

function sampleDocuments(): Map<string, { ids: Uint32Array; counts: Uint32Array; length: number }> {
  return new Map([
    [KEY_A, { ids: Uint32Array.of(0, 2), counts: Uint32Array.of(3, 1), length: 4 }],
    [KEY_B, { ids: Uint32Array.of(1), counts: Uint32Array.of(2), length: 2 }],
  ])
}

function plain(decoded: RecallTermStore | undefined): unknown {
  if (decoded === undefined) return undefined
  return {
    ...decoded,
    documents: [...decoded.documents].map(([key, terms]) => [key, [...terms.ids], [...terms.counts], terms.length]),
  }
}

// Storage contract: the store outlives the process that wrote it, so every byte the next process
// reads back must either round-trip exactly or reject the whole store.
describe("recall term store codec", () => {
  it("#given a store #when encoded and decoded, also from an unaligned array or Buffer #then it reads back exactly", () => {
    // given
    const bytes = encodeRecallTermStore(store())
    const unaligned = new Uint8Array(bytes.length + 1).subarray(1)
    unaligned.set(bytes)
    const unalignedBuffer = Buffer.alloc(bytes.length + 1).subarray(1)
    unalignedBuffer.set(bytes)

    // when
    const decoded = [decodeRecallTermStore(bytes), decodeRecallTermStore(unaligned), decodeRecallTermStore(unalignedBuffer)]

    // then
    for (const result of decoded) expect(plain(result)).toEqual(plain(store()))
  })

  it.each([
    ["an empty file", () => new Uint8Array()],
    ["a truncated file", (bytes: Uint8Array) => bytes.subarray(0, bytes.length - 4)],
    ["a trailing byte", (bytes: Uint8Array) => Uint8Array.of(...bytes, 0)],
    ["another magic", (bytes: Uint8Array) => withWord(bytes, 0, 0)],
    ["another format version", (bytes: Uint8Array) => withWord(bytes, 1, 99)],
    ["a term count that disagrees with the terms", (bytes: Uint8Array) => withWord(bytes, 4, 2)],
  ])("#given %s #when decoded #then the store is rejected", (_, damage) => {
    expect(decodeRecallTermStore(damage(encodeRecallTermStore(store())))).toBeUndefined()
  })

  it.each([
    ["an id past the terms", { ids: Uint32Array.of(0, 3), counts: Uint32Array.of(1, 1), length: 2 }],
    ["ids out of order", { ids: Uint32Array.of(2, 0), counts: Uint32Array.of(1, 1), length: 2 }],
    ["a zero count", { ids: Uint32Array.of(0), counts: Uint32Array.of(0), length: 1 }],
  ])("#given a document with %s #when decoded #then the store is rejected", (_, terms) => {
    expect(decodeRecallTermStore(encodeRecallTermStore(store(new Map([[KEY_A, terms]]))))).toBeUndefined()
  })

  it("#given no documents and no terms #when encoded and decoded #then an empty store reads back", () => {
    const empty: RecallTermStore = { fingerprint: "tokenizer-v1", terms: [], documents: new Map() }
    expect(plain(decodeRecallTermStore(encodeRecallTermStore(empty)))).toEqual(plain(empty))
  })
})

function withWord(bytes: Uint8Array, word: number, value: number): Uint8Array {
  const copy = bytes.slice()
  new DataView(copy.buffer).setUint32(word * 4, value, true)
  return copy
}
