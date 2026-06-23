import { bytesEqual, hexToBytes } from "./bytes-codec"
import { newPrefilledHasher } from "./hash"
import type { DsHashV1Challenge, DsHashV1Solution } from "./types"
import { buildPrefix } from "./types"

const enc = new TextEncoder()

const TARGET_BYTES = 32

export function solveDeepSeekHashV1(challenge: DsHashV1Challenge): DsHashV1Solution {
  if (challenge.algorithm !== "DeepSeekHashV1") {
    throw new Error(`unsupported algorithm: ${challenge.algorithm}`)
  }
  const target = hexToBytes(challenge.challenge)
  if (target.length !== TARGET_BYTES) {
    throw new Error(`expected ${TARGET_BYTES}-byte challenge target, got ${target.length}`)
  }
  if (!Number.isInteger(challenge.difficulty) || challenge.difficulty <= 0) {
    throw new Error(`difficulty must be a positive integer, got ${challenge.difficulty}`)
  }
  const prefix = enc.encode(buildPrefix(challenge.salt, challenge.expire_at))
  const base = newPrefilledHasher(prefix)
  const t0 = performance.now()
  for (let nonce = 0; nonce < challenge.difficulty; nonce++) {
    const candidate = base.clone()
    candidate.update(enc.encode(nonce.toString()))
    if (bytesEqual(candidate.digest(), target)) {
      return { answer: nonce, ms: performance.now() - t0 }
    }
  }
  throw new Error(
    `deepseek pow solver exhausted difficulty=${challenge.difficulty} without finding a solution for challenge=${challenge.challenge}`,
  )
}
