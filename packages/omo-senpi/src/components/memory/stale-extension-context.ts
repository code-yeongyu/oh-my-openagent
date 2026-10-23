/**
 * Message prefixes senpi's runner guard throws from a retired extension ctx: the first comes from
 * session replacement (newSession, fork, switchSession) and the explicit reload path, the second
 * from the runtime's own reload, which invalidates the previous runner generation with a shorter
 * message. See #7946 and #10339.
 */
const STALE_EXTENSION_CONTEXT_ERROR_PREFIXES = [
  "This extension ctx is stale after session replacement or reload.",
  "stale extension generation after reload",
] as const

export function isStaleExtensionContextError(error: unknown): boolean {
  return error instanceof Error
    && STALE_EXTENSION_CONTEXT_ERROR_PREFIXES.some((prefix) => error.message.startsWith(prefix))
}
