import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { runInNewContext } from "node:vm"
import { describe, expect, test } from "bun:test"
import { bunHashXxh32 as runtimeBunHashXxh32 } from "./bun-hash-shim"

type HashFunction = (input: string, seed: number) => number
type HashPair = { input: string; seed: number }
type BunHashTestRuntime = {
  hash: { xxHash32(data: string | Uint8Array, seed: number): number }
  Transpiler: new (options: { loader: "ts" }) => { transformSync(source: string): string }
}
type HashSandbox = {
  Math: Math
  TextEncoder: typeof TextEncoder
  Uint8Array: Uint8ArrayConstructor
  __bunHashShim?: { bunHashXxh32: HashFunction }
}

const runtime = globalThis as typeof globalThis & { Bun: BunHashTestRuntime }
const FUZZ_PAIR_COUNT = 1_200
const FIXED_LENGTHS = [0, 1, 2, 3, 4, 15, 16, 17, 31, 32, 33, 64, 100, 255, 500]
const FIXED_SEEDS = [0, 1, 42, 12345, 0xdeadbeef, 0xffffffff]
const CONTENT_FRAGMENTS = ["你好世界", "\u{1f389}", "\u{1f525}", "\n", "\r\n", "\t", " "]
const SPECIAL_INPUTS = [
  "",
  " ",
  "\t\n\r\n",
  "hello world",
  "你好世界",
  "\u{1f389}\u{1f525}",
  "mixed 你好 \u{1f389} ascii",
  "line one\nline two\r\n\tindented",
]
const PURE_JS_HASH = loadPureJsBunHashXxh32()
const FUZZ_PAIRS = createFuzzPairs()

function loadPureJsBunHashXxh32(): HashFunction {
  const sourcePath = join(dirname(fileURLToPath(import.meta.url)), "bun-hash-shim.ts")
  const source = readFileSync(sourcePath, "utf8")
  const exportSignature = "export function bunHashXxh32(input: string, seed: number): number {"

  if (!source.includes(exportSignature)) {
    throw new Error("bunHashXxh32 export signature changed")
  }

  const scriptSource = `${source.replace(
    exportSignature,
    "function bunHashXxh32(input: string, seed: number): number {",
  )}\nglobalThis.__bunHashShim = { bunHashXxh32 }\n`
  const transpiler = new runtime.Bun.Transpiler({ loader: "ts" })
  const script = transpiler.transformSync(scriptSource)
  const sandbox: HashSandbox = { Math, TextEncoder, Uint8Array }

  runInNewContext(script, sandbox, { filename: sourcePath })

  const pureJsHash = sandbox.__bunHashShim?.bunHashXxh32
  if (!pureJsHash) {
    throw new Error("pure-JS bunHashXxh32 loader failed")
  }

  return pureJsHash
}

function createUint32Generator(seed: number): () => number {
  let state = seed >>> 0

  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0

    return state
  }
}

function createSeed(pairIndex: number, nextUint32: () => number): number {
  if (pairIndex % (FIXED_SEEDS.length + 1) === FIXED_SEEDS.length) return nextUint32()

  return FIXED_SEEDS[pairIndex % FIXED_SEEDS.length] ?? 0
}

function createRandomString(length: number, nextUint32: () => number): string {
  let value = ""

  while (value.length < length) {
    if (nextUint32() % 10 < 6) {
      value += String.fromCharCode(32 + (nextUint32() % 95))
      continue
    }

    const fragment = CONTENT_FRAGMENTS[nextUint32() % CONTENT_FRAGMENTS.length] ?? " "
    if (value.length + fragment.length <= length) {
      value += fragment
      continue
    }

    value += String.fromCharCode(32 + (nextUint32() % 95))
  }

  return value
}

function createFuzzPairs(): HashPair[] {
  const nextUint32 = createUint32Generator(0x5eed1234)
  const pairs: HashPair[] = []

  for (const input of SPECIAL_INPUTS) {
    pairs.push({ input, seed: createSeed(pairs.length, nextUint32) })
  }

  for (const length of FIXED_LENGTHS) {
    pairs.push({ input: createRandomString(length, nextUint32), seed: createSeed(pairs.length, nextUint32) })
  }

  while (pairs.length < FUZZ_PAIR_COUNT) {
    const randomLength = nextUint32() % 501
    const length = pairs.length % 13 === 0 ? (FIXED_LENGTHS[pairs.length % FIXED_LENGTHS.length] ?? randomLength) : randomLength
    pairs.push({ input: createRandomString(length, nextUint32), seed: createSeed(pairs.length, nextUint32) })
  }

  return pairs
}

function nativeXxh32(input: string, seed: number): number {
  return runtime.Bun.hash.xxHash32(input, seed)
}

function createMismatchMessage(label: string, input: string, seed: number, expected: number, actual: number): string {
  return `${label} mismatch for input=${JSON.stringify(input)} seed=${seed} expected=${expected} actual=${actual}`
}

function expectPureJsHashToMatchBun(label: string, input: string, seed: number): void {
  const expected = nativeXxh32(input, seed)
  const actual = PURE_JS_HASH(input, seed)

  if (actual !== expected) {
    throw new Error(createMismatchMessage(label, input, seed, expected, actual))
  }
}

describe("#given known XXH32 test vectors", () => {
  test("#when pure-JS hash is called #then returns canonical values", () => {
    expect(PURE_JS_HASH("", 0)).toBe(0x02cc5d05)
    expect(PURE_JS_HASH("a", 0)).toBe(0x550d7456)
    expect(PURE_JS_HASH("abc", 0)).toBe(0x32d153ff)
  })

  test("#when a non-zero seed is used #then matches Bun hash", () => {
    expectPureJsHashToMatchBun("seeded vector", "test", 42)
    expect(runtimeBunHashXxh32("test", 42)).toBe(nativeXxh32("test", 42))
  })
})

describe("#given random inputs #when hashed with pure-JS and Bun.hash", () => {
  test("#then all fuzz pairs are bit-exact", () => {
    expect(FUZZ_PAIRS).toHaveLength(FUZZ_PAIR_COUNT)

    for (const [pairIndex, pair] of FUZZ_PAIRS.entries()) {
      expectPureJsHashToMatchBun(`fuzz pair ${pairIndex}`, pair.input, pair.seed)
    }
  })
})

describe("#given production-like inputs", () => {
  test("#when hashed with line-number seeds #then pure-JS matches Bun hash", () => {
    const inputs = ["  const x = 42;", "import { foo } from 'bar'", "// comment", ""]
    const seeds = [0, 1, 50, 100, 999]

    for (const input of inputs) {
      for (const seed of seeds) {
        expectPureJsHashToMatchBun("production-like input", input, seed)
      }
    }
  })
})
