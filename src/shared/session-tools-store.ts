import { safeCompress, DEFAULT_COMPRESSION_CONFIG } from "./toon-compression"

const store = new Map<string, string>()

export function setSessionTools(sessionID: string, tools: Record<string, boolean>): void {
   const compressed = safeCompress(tools, "session-tools-store")
   store.set(sessionID, compressed)
 }

export function getSessionTools(sessionID: string): Record<string, boolean> | undefined {
  const compressed = store.get(sessionID)
  if (!compressed) {
    return undefined
  }
  try {
    return JSON.parse(compressed) as Record<string, boolean>
  } catch {
    return undefined
  }
}

export function deleteSessionTools(sessionID: string): void {
  store.delete(sessionID);
}

export function clearSessionTools(): void {
  store.clear();
}
