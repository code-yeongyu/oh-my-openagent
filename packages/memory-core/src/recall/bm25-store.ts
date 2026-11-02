// Binary codec of the persisted recall term store. The store is a derived cache: a decode that finds
// anything wrong returns `undefined` and recall tokenizes the documents again, never trusting a part.
//
// Layout, native-endian u32 words unless noted (a store from a host of the other endianness fails the magic check):
//   header      MAGIC, FORMAT_VERSION, fingerprint bytes, term bytes, term count, document count, entry count
//   fingerprint UTF-8, the tokenizer fingerprint the terms were made with
//   terms       UTF-8, the terms joined by "\n" (a term is letters, marks and digits only), padded to 4 bytes
//   keys        20 bytes per document, the SHA-1 of the text its terms were made from
//   documents   per document: BM25 length, number of distinct terms
//   ids, counts every document's term ids (ascending per document), then every document's counts

import type { StoredDocumentTerms } from "./bm25-index"

const MAGIC = 0x3142_524f
const FORMAT_VERSION = 1
const HEADER_WORDS = 7
const KEY_BYTES = 20

export interface RecallTermStore {
  readonly fingerprint: string
  readonly terms: readonly string[]
  /** Hex SHA-1 of a document's `description\nbody` -> its terms against `terms`. */
  readonly documents: ReadonlyMap<string, StoredDocumentTerms>
}

const pad4 = (bytes: number): number => (bytes + 3) & ~3

export function encodeRecallTermStore(store: RecallTermStore): Uint8Array {
  const encoder = new TextEncoder()
  const fingerprint = encoder.encode(store.fingerprint)
  const terms = encoder.encode(store.terms.join("\n"))
  const documents = [...store.documents]
  const entries = documents.reduce((sum, [, document]) => sum + document.ids.length, 0)
  const textBytes = pad4(fingerprint.length + terms.length)
  const keysOffset = HEADER_WORDS * 4 + textBytes
  const wordsOffset = keysOffset + documents.length * KEY_BYTES
  const bytes = new Uint8Array(wordsOffset + (documents.length * 2 + entries * 2) * 4)
  const header = new Uint32Array(bytes.buffer, 0, HEADER_WORDS)
  header.set([MAGIC, FORMAT_VERSION, fingerprint.length, terms.length, store.terms.length, documents.length, entries])
  bytes.set(fingerprint, HEADER_WORDS * 4)
  bytes.set(terms, HEADER_WORDS * 4 + fingerprint.length)
  const words = new Uint32Array(bytes.buffer, wordsOffset)
  let entry = documents.length * 2
  documents.forEach(([key, document], position) => {
    bytes.set(hexBytes(key), keysOffset + position * KEY_BYTES)
    words[position * 2] = document.length
    words[position * 2 + 1] = document.ids.length
    words.set(document.ids, entry)
    words.set(document.counts, entry + entries)
    entry += document.ids.length
  })
  return bytes
}

/** `undefined` for anything but a complete, consistent store of this format. */
export function decodeRecallTermStore(input: Uint8Array): RecallTermStore | undefined {
  // A Uint32Array view needs a 4-byte aligned offset; a Buffer from the pool may not have one. The
  // constructor copies (Buffer#slice would return a view at the same misaligned offset).
  const bytes = input.byteOffset % 4 === 0 ? input : new Uint8Array(input)
  if (bytes.length < HEADER_WORDS * 4) return undefined
  const [magic, version, fingerprintBytes = 0, termBytes = 0, termCount = 0, documentCount = 0, entries = 0] =
    new Uint32Array(bytes.buffer, bytes.byteOffset, HEADER_WORDS)
  if (magic !== MAGIC || version !== FORMAT_VERSION) return undefined
  const keysOffset = HEADER_WORDS * 4 + pad4(fingerprintBytes + termBytes)
  const wordsOffset = keysOffset + documentCount * KEY_BYTES
  if (bytes.length !== wordsOffset + (documentCount * 2 + entries * 2) * 4) return undefined

  const decoder = new TextDecoder("utf-8", { fatal: true })
  let fingerprint: string
  let termsText: string
  try {
    fingerprint = decoder.decode(bytes.subarray(HEADER_WORDS * 4, HEADER_WORDS * 4 + fingerprintBytes))
    termsText = decoder.decode(bytes.subarray(HEADER_WORDS * 4 + fingerprintBytes, HEADER_WORDS * 4 + fingerprintBytes + termBytes))
  } catch {
    return undefined
  }
  const terms = termCount === 0 && termsText === "" ? [] : termsText.split("\n")
  if (terms.length !== termCount) return undefined

  const words = new Uint32Array(bytes.buffer, bytes.byteOffset + wordsOffset, documentCount * 2 + entries * 2)
  const documents = new Map<string, StoredDocumentTerms>()
  let entry = documentCount * 2
  for (let position = 0; position < documentCount; position += 1) {
    const length = words[position * 2] ?? 0
    const distinct = words[position * 2 + 1] ?? 0
    if (entry + distinct > documentCount * 2 + entries) return undefined
    const ids = words.subarray(entry, entry + distinct)
    const counts = words.subarray(entry + entries, entry + entries + distinct)
    if (!isValidDocument(ids, counts, termCount)) return undefined
    const key = keyHex(bytes.subarray(keysOffset + position * KEY_BYTES, keysOffset + (position + 1) * KEY_BYTES))
    if (documents.has(key)) return undefined
    documents.set(key, { ids, counts, length })
    entry += distinct
  }
  if (entry !== documentCount * 2 + entries) return undefined
  return { fingerprint, terms, documents }
}

function isValidDocument(ids: Uint32Array, counts: Uint32Array, termCount: number): boolean {
  let previous = -1
  for (let position = 0; position < ids.length; position += 1) {
    const id = ids[position] ?? termCount
    if (id <= previous || id >= termCount || (counts[position] ?? 0) === 0) return false
    previous = id
  }
  return true
}

function hexBytes(hex: string): Uint8Array {
  return Uint8Array.from({ length: KEY_BYTES }, (_, position) => Number.parseInt(hex.slice(position * 2, position * 2 + 2), 16))
}

function keyHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
}
