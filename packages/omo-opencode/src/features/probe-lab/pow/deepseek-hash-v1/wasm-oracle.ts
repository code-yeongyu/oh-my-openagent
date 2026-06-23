import { DEEPSEEK_HASH_V1_WASM_BASE64 } from "./wasm-binary"
import type { DsHashV1Challenge, DsHashV1Solution } from "./types"
import { buildPrefix } from "./types"

interface WasmExports {
  memory: WebAssembly.Memory
  wasm_solve: (a: number, b: number, c: number, d: number, e: number, f: number) => void
  wasm_deepseek_hash_v1: (a: number, b: number, c: number) => void
  __wbindgen_export_0: (size: number, align: number) => number
  __wbindgen_add_to_stack_pointer: (n: number) => number
}

let cachedExports: WasmExports | null = null

function decodeBase64(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"))
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function loadWasm(): WasmExports {
  if (cachedExports) return cachedExports
  const bytes = decodeBase64(DEEPSEEK_HASH_V1_WASM_BASE64)
  const buf = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buf).set(bytes)
  const mod = new WebAssembly.Module(buf)
  const inst = new WebAssembly.Instance(mod, {})
  cachedExports = inst.exports as unknown as WasmExports
  return cachedExports
}

const enc = new TextEncoder()
const dec = new TextDecoder()

function writeBytes(exp: WasmExports, bytes: Uint8Array): { ptr: number; len: number } {
  if (bytes.length === 0) return { ptr: 1, len: 0 }
  const ptr = exp.__wbindgen_export_0(bytes.length, 1)
  new Uint8Array(exp.memory.buffer).set(bytes, ptr)
  return { ptr, len: bytes.length }
}

export function solveDeepSeekHashV1ViaWasm(challenge: DsHashV1Challenge): DsHashV1Solution {
  const exp = loadWasm()
  const ret = exp.__wbindgen_add_to_stack_pointer(-16)
  try {
    const c = writeBytes(exp, enc.encode(challenge.challenge))
    const p = writeBytes(exp, enc.encode(buildPrefix(challenge.salt, challenge.expire_at)))
    const t0 = performance.now()
    exp.wasm_solve(ret, c.ptr, c.len, p.ptr, p.len, challenge.difficulty)
    const ms = performance.now() - t0
    const flag = new Uint32Array(exp.memory.buffer)[ret / 4]!
    const nonce = new Float64Array(exp.memory.buffer)[(ret + 8) / 8]!
    if (flag !== 1) {
      throw new Error(`wasm solver returned no solution for challenge=${challenge.challenge} difficulty=${challenge.difficulty}`)
    }
    return { answer: nonce, ms }
  } finally {
    exp.__wbindgen_add_to_stack_pointer(16)
  }
}

export function dsHashV1ViaWasm(input: Uint8Array): Uint8Array {
  const exp = loadWasm()
  const ret = exp.__wbindgen_add_to_stack_pointer(-16)
  try {
    const { ptr, len } = writeBytes(exp, input)
    exp.wasm_deepseek_hash_v1(ret, ptr, len)
    const v32 = new Uint32Array(exp.memory.buffer)
    const outPtr = v32[ret / 4]!
    const outLen = v32[ret / 4 + 1]!
    const ascii = new Uint8Array(exp.memory.buffer.slice(outPtr, outPtr + outLen))
    const hexStr = dec.decode(ascii)
    const out = new Uint8Array(hexStr.length / 2)
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hexStr.slice(i * 2, i * 2 + 2), 16)
    return out
  } finally {
    exp.__wbindgen_add_to_stack_pointer(16)
  }
}
