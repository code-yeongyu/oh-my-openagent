// The fake relay's session keys. The local API names a session by a 22-character stream key the relay mints, never by
// the routing id B's engine lists it under (spec-proto.ts SESSION_KEY_CHARS), so the relay keeps both directions: the
// key it hands out for each B routing id, and B's durable id to that key, which session.locate answers.
import { createHash } from "node:crypto"

const SESSION_KEY_CHARS = 22

export type KeyBook = {
  /** The key of a B session, learned from an open's reply or a listing row; the same routing id keeps its key. */
  readonly learn: (routing: string, durable?: string) => string
  readonly routingOf: (key: string) => string | undefined
  readonly locate: (durable: string) => string | undefined
}

export function createKeyBook(): KeyBook {
  const routes = new Map<string, string>()
  const byDurable = new Map<string, string>()
  return {
    learn: (routing, durable) => {
      const key = createHash("sha256").update(routing).digest("base64url").slice(0, SESSION_KEY_CHARS)
      routes.set(key, routing)
      if (durable !== undefined) byDurable.set(durable, key)
      return key
    },
    routingOf: (key) => routes.get(key),
    locate: (durable) => byDurable.get(durable),
  }
}
