// Last-resort defense: sanitize lone surrogates from ALL outgoing fetch bodies.
// Necessary because message-level hooks cannot cover system prompts, tool
// definitions, or other SDK-injected content. isWellFormed() fast-path skips
// clean bodies with negligible overhead.

const PATCH_MARKER = Symbol.for("omo.fetch.surrogateSanitized")

export function patchFetchForSurrogates(): void {
  if ((globalThis as Record<symbol, unknown>)[PATCH_MARKER]) return

  const originalFetch = globalThis.fetch

  globalThis.fetch = function patchedFetch(
    this: unknown,
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    if (init?.body && typeof init.body === "string") {
      if (!init.body.isWellFormed()) {
        init = { ...init, body: init.body.toWellFormed() }
      }
    }
    return originalFetch.call(this, input, init)
  } as typeof fetch

  ;(globalThis as Record<symbol, unknown>)[PATCH_MARKER] = true
}
