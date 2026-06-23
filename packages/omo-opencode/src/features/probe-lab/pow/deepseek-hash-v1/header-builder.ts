import type { DsHashV1Challenge } from "./types"

export const DEEPSEEK_POW_HEADER_NAME = "X-DS-PoW-Response"
export const DEEPSEEK_GUEST_POW_HEADER_NAME = "X-DS-Guest-PoW-Response"

export interface DsHashV1HeaderInput {
  challenge: DsHashV1Challenge
  answer: number
  target_path?: string
}

export function buildPowResponseHeader(input: DsHashV1HeaderInput): { name: string; value: string } {
  const target_path = input.target_path ?? input.challenge.target_path
  const payload = {
    algorithm: input.challenge.algorithm,
    challenge: input.challenge.challenge,
    salt: input.challenge.salt,
    answer: input.answer,
    signature: input.challenge.signature,
    target_path,
  }
  return { name: DEEPSEEK_POW_HEADER_NAME, value: base64Encode(JSON.stringify(payload)) }
}

export function buildGuestPowResponseHeader(input: { salt: string; answer: number }): { name: string; value: string } {
  const payload = { salt: input.salt, answer: input.answer }
  return { name: DEEPSEEK_GUEST_POW_HEADER_NAME, value: base64Encode(JSON.stringify(payload)) }
}

function base64Encode(s: string): string {
  if (typeof btoa === "function") return btoa(s)
  return Buffer.from(s, "utf8").toString("base64")
}
