/**
 * Thought Signature Store
 *
 * Stores and retrieves thought signatures for multi-turn conversations.
 * Gemini 3 Pro requires thought_signature on function call content blocks
 * in subsequent requests to maintain reasoning continuity.
 *
 * Key responsibilities:
 * - Store the latest thought signature per session
 * - Provide signature for injection into function call requests
 * - Clear signatures when sessions end
 */

/**
 * In-memory store for thought signatures indexed by session ID
 */
const signatureStore = new Map<string, string>()

/**
 * In-memory store for session IDs per fetch instance
 * Used to maintain consistent sessionId across multi-turn conversations
 */
const sessionIdStore = new Map<string, string>()

/**
 * Store a thought signature for a session
 *
 * @param sessionKey - Unique session identifier (typically fetch instance ID)
 * @param signature - The thought signature from model response
 */
export function setThoughtSignature(sessionKey: string, signature: string): void {
  if (sessionKey && signature) {
    signatureStore.set(sessionKey, signature)
  }
}

/**
 * Retrieve the stored thought signature for a session
 *
 * @param sessionKey - Unique session identifier
 * @returns The stored signature or undefined if not found
 */
export function getThoughtSignature(sessionKey: string): string | undefined {
  return signatureStore.get(sessionKey)
}

/**
 * Clear the thought signature for a session
 *
 * @param sessionKey - Unique session identifier
 */
export function clearThoughtSignature(sessionKey: string): void {
  signatureStore.delete(sessionKey)
}

/**
 * Store or retrieve a persistent session ID for a fetch instance
 *
 * @param fetchInstanceId - Unique identifier for the fetch instance
 * @param sessionId - Optional session ID to store (if not provided, returns existing or generates new)
 * @returns The session ID for this fetch instance
 */
export function getOrCreateSessionId(fetchInstanceId: string, sessionId?: string): string {
  if (sessionId) {
    sessionIdStore.set(fetchInstanceId, sessionId)
    return sessionId
  }

  const existing = sessionIdStore.get(fetchInstanceId)
  if (existing) {
    return existing
  }

  const n = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)
  const newSessionId = `-${n}`
  sessionIdStore.set(fetchInstanceId, newSessionId)
  return newSessionId
}

/**
 * Clear the session ID for a fetch instance
 *
 * @param fetchInstanceId - Unique identifier for the fetch instance
 */
export function clearSessionId(fetchInstanceId: string): void {
  sessionIdStore.delete(fetchInstanceId)
}

/**
 * Clear all stored data for a fetch instance (signature + session ID)
 *
 * @param fetchInstanceId - Unique identifier for the fetch instance
 */
export function clearFetchInstanceData(fetchInstanceId: string): void {
  signatureStore.delete(fetchInstanceId)
  sessionIdStore.delete(fetchInstanceId)
}
