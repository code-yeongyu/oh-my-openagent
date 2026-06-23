const BEARER_PREFIX = "Bearer "

export type AuthResult =
  | { ok: true }
  | { ok: false; reason: "missing_header" | "invalid_scheme" | "invalid_token" }

export function checkBearerAuth(request: Request, expectedToken: string): AuthResult {
  const header = request.headers.get("authorization")
  if (!header) return { ok: false, reason: "missing_header" }
  if (!header.startsWith(BEARER_PREFIX)) return { ok: false, reason: "invalid_scheme" }

  const presented = header.slice(BEARER_PREFIX.length).trim()
  if (presented.length === 0) return { ok: false, reason: "invalid_token" }
  if (!constantTimeEqual(presented, expectedToken)) return { ok: false, reason: "invalid_token" }
  return { ok: true }
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}
