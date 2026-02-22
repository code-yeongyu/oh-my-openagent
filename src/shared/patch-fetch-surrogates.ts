// Last-resort defense: sanitize lone surrogates from ALL outgoing fetch bodies.
// Two layers: (1) toWellFormed() for literal surrogate code units,
// (2) fixJsonSurrogateEscapes() for JSON escape sequences like \uD800.

import { fixJsonSurrogateEscapes } from "./fix-json-surrogate-escapes"

const PATCH_MARKER = Symbol.for("omo.fetch.surrogateSanitized")

function sanitizeFetchBody(body: string): string {
  let result = body
  if (!result.isWellFormed()) {
    result = result.toWellFormed()
  }
  result = fixJsonSurrogateEscapes(result)
  return result
}

async function sanitizeRequestBody(
  input: Request,
  originalFetch: typeof fetch,
  context: unknown,
  init?: RequestInit,
): Promise<Response> {
  try {
    const body = await input.clone().text()
    const sanitized = sanitizeFetchBody(body)
    if (sanitized === body) return originalFetch.call(context, input, init)
    const headers = new Headers(input.headers)
    headers.delete("content-length")
    const newReq = new Request(input, { body: sanitized, headers })
    return originalFetch.call(context, newReq, init)
  } catch {
    return originalFetch.call(context, input, init)
  }
}

export function patchFetchForSurrogates(): void {
  if ((globalThis as Record<symbol, unknown>)[PATCH_MARKER]) return

  const originalFetch = globalThis.fetch

  globalThis.fetch = function patchedFetch(
    this: unknown,
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    if (init?.body && typeof init.body === "string") {
      const sanitized = sanitizeFetchBody(init.body)
      if (sanitized !== init.body) {
        init = { ...init, body: sanitized }
      }
      return originalFetch.call(this, input, init)
    }

    if (input instanceof Request && !init?.body && input.body !== null) {
      return sanitizeRequestBody(input, originalFetch, this, init)
    }

    return originalFetch.call(this, input, init)
  } as typeof fetch

  ;(globalThis as Record<symbol, unknown>)[PATCH_MARKER] = true
}
