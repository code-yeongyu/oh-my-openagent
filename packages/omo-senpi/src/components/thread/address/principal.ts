import { UNKNOWN_CALLER } from "../tools/ports"

/** Who resolves: only a session has a caller of its own (`self`, the caller excluded from an id prefix). */
export type ResolvePrincipal =
  | { readonly kind: "session"; readonly id: string }
  | { readonly kind: "script" }
  | { readonly kind: "person" }
  | { readonly kind: "connector" }

/**
 * The principal a thread tool's caller id names: a session's durable id, or a script when no session context exists. Its
 * own module, because omo.js callers need it without the resolver the thread client sidecar carries.
 */
export const principalOf = (callerId: string): ResolvePrincipal =>
  callerId === UNKNOWN_CALLER ? { kind: "script" } : { kind: "session", id: callerId }
