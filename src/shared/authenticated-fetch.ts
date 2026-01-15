/**
 * Creates a fetch wrapper that adds HTTP Basic Auth headers.
 * Password is read lazily at first use (after OpenCode sets it post-plugin-init).
 * 
 * Handles both Request objects (SDK style) and url+init style calls.
 */
export function createAuthenticatedFetch(): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  const username = process.env.OPENCODE_SERVER_USERNAME ?? "opencode"
  
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    // Read password lazily - OpenCode sets it after plugin initialization
    const password = process.env.OPENCODE_SERVER_PASSWORD ?? ""
    
    // SDK passes a Request object directly (not url + init)
    // We need to clone it and add auth headers while preserving body
    if (input instanceof Request) {
      // Clone the request first to preserve the body stream
      const cloned = input.clone()
      
      // Build new headers with auth - convert to Record for Bun compatibility
      const headersObj: Record<string, string> = {}
      cloned.headers.forEach((value, key) => {
        headersObj[key] = value
      })
      if (password) {
        const credentials = Buffer.from(`${username}:${password}`).toString("base64")
        headersObj["Authorization"] = `Basic ${credentials}`
      }
      
      // Create new request with auth headers AND preserved body
      // CRITICAL: Must explicitly pass body, method, and other properties
      // just passing { headers } does NOT copy the body from the original request
      const newRequest = new Request(cloned.url, {
        method: cloned.method,
        headers: headersObj,
        body: cloned.body,
        mode: cloned.mode,
        credentials: cloned.credentials,
        cache: cloned.cache,
        redirect: cloned.redirect,
        referrer: cloned.referrer,
        referrerPolicy: cloned.referrerPolicy,
        integrity: cloned.integrity,
        keepalive: cloned.keepalive,
        signal: cloned.signal,
      })
      return fetch(newRequest)
    }
    
    // Fallback for url + init style calls
    const headers = new Headers(init?.headers)
    if (password) {
      const credentials = Buffer.from(`${username}:${password}`).toString("base64")
      headers.set("Authorization", `Basic ${credentials}`)
    }
    
    return fetch(input, {
      ...init,
      headers,
    })
  }
}
