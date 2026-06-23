import { Keccak } from "@noble/hashes/sha3.js"
import { bytesToHex } from "./bytes-codec"

const KECCAK_RATE = 136
const KECCAK_SUFFIX = 0x06
const KECCAK_OUTPUT = 32
const KECCAK_ROUNDS = 23

export function dsHashV1(input: Uint8Array): Uint8Array {
  const k = new Keccak(KECCAK_RATE, KECCAK_SUFFIX, KECCAK_OUTPUT, false, KECCAK_ROUNDS)
  k.update(input)
  return k.digest()
}

export function dsHashV1Hex(input: Uint8Array): string {
  return bytesToHex(dsHashV1(input))
}

export function newPrefilledHasher(prefix: Uint8Array): Keccak {
  const k = new Keccak(KECCAK_RATE, KECCAK_SUFFIX, KECCAK_OUTPUT, false, KECCAK_ROUNDS)
  k.update(prefix)
  return k
}
