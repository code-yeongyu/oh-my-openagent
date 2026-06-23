export interface DsHashV1Challenge {
  algorithm: "DeepSeekHashV1"
  challenge: string
  salt: string
  signature: string
  difficulty: number
  expire_at: number
  expire_after: number
  target_path: string
}

export interface DsHashV1Solution {
  answer: number
  ms: number
}

export function buildPrefix(salt: string, expireAt: number): string {
  return `${salt}_${expireAt}_`
}
