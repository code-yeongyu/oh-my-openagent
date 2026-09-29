// The loopback surface's shared secret.
//
// The surface listens only on the loopback address, but on a shared machine every local user can
// reach that address. The token is what makes "local" mean "this operator": it lives in a file only
// the owner can read, and a request without it is refused before it reaches the driver.

import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const TOKEN_BYTES = 32

/** Where the token lives for an agent directory. */
export const tokenPathFor = (agentDir: string): string => join(agentDir, "gateway", "huddle", "token")

/**
 * Read the token, creating it on first use.
 *
 * The file is always left readable by its owner alone: a token that leaked to other local users
 * would hand them the call, so a loose mode is tightened rather than tolerated.
 */
export function loadOrCreateToken(path: string): string {
  mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 })
  try {
    const existing = readFileSync(path, "utf8").trim()
    if (existing.length > 0) {
      if ((statSync(path).mode & 0o077) !== 0) chmodSync(path, 0o600)
      return existing
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
  }
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES))).toString("hex")
  writeFileSync(path, `${token}\n`, { mode: 0o600 })
  chmodSync(path, 0o600)
  return token
}

/** Constant-time comparison, so a wrong token cannot be narrowed down by timing the answer. */
export function tokenMatches(expected: string, offered: string | null): boolean {
  if (offered === null) return false
  const a = new TextEncoder().encode(expected)
  const b = new TextEncoder().encode(offered)
  if (a.byteLength !== b.byteLength) return false
  let difference = 0
  for (let i = 0; i < a.byteLength; i++) difference |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return difference === 0
}

const BEARER = "bearer "
const PROTOCOL_PREFIX = "omo-huddle."

/**
 * The token a request offers: an Authorization header, or the websocket subprotocol for clients that
 * cannot set headers. A query parameter is deliberately not accepted - it would land in logs.
 */
export function offeredToken(headers: Headers): string | null {
  const authorization = headers.get("authorization")
  if (authorization !== null && authorization.toLowerCase().startsWith(BEARER)) return authorization.slice(BEARER.length).trim()
  const protocols = headers.get("sec-websocket-protocol")
  if (protocols === null) return null
  for (const entry of protocols.split(",")) {
    const trimmed = entry.trim()
    if (trimmed.startsWith(PROTOCOL_PREFIX)) return trimmed.slice(PROTOCOL_PREFIX.length)
  }
  return null
}
