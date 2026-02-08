import type { ManagedClient, SkillMcpManagerState } from "./types"

async function closeManagedClient(managed: ManagedClient): Promise<void> {
  try {
    await managed.client.close()
  } catch {
    // Ignore close errors - process may already be terminated
  }

  try {
    await managed.transport.close()
  } catch {
    // Transport may already be terminated
  }
}

export function registerProcessCleanup(state: SkillMcpManagerState): void {
  if (state.cleanupRegistered) return
  state.cleanupRegistered = true

  const cleanup = async (): Promise<void> => {
    for (const managed of state.clients.values()) {
      await closeManagedClient(managed)
    }
    state.clients.clear()
    state.pendingConnections.clear()
  }

  // Note: Node's 'exit' event is synchronous-only, so we rely on signal handlers for async cleanup.
  // Signal handlers invoke the async cleanup function and ignore errors so they don't block or throw.
  // Don't call process.exit() here - let the background-agent manager handle the final process exit.
  // Use void + catch to trigger async cleanup without awaiting it in the signal handler.

  const register = (signal: NodeJS.Signals) => {
    const listener = () => void cleanup().catch(() => {})
    state.cleanupHandlers.push({ signal, listener })
    process.on(signal, listener)
  }

  register("SIGINT")
  register("SIGTERM")
  if (process.platform === "win32") {
    register("SIGBREAK")
  }
}

export function unregisterProcessCleanup(state: SkillMcpManagerState): void {
  if (!state.cleanupRegistered) return
  for (const { signal, listener } of state.cleanupHandlers) {
    process.off(signal, listener)
  }
  state.cleanupHandlers = []
  state.cleanupRegistered = false
}

export function startCleanupTimer(state: SkillMcpManagerState): void {
  if (state.cleanupInterval) return

  state.cleanupInterval = setInterval(() => {
    void cleanupIdleClients(state).catch(() => {})
  }, 60_000)

  state.cleanupInterval.unref()
}

export function stopCleanupTimer(state: SkillMcpManagerState): void {
  if (!state.cleanupInterval) return
  clearInterval(state.cleanupInterval)
  state.cleanupInterval = null
}

async function cleanupIdleClients(state: SkillMcpManagerState): Promise<void> {
  const now = Date.now()

  for (const [key, managed] of state.clients) {
    if (now - managed.lastUsedAt > state.idleTimeoutMs) {
      state.clients.delete(key)
      await closeManagedClient(managed)
    }
  }

  if (state.clients.size === 0) {
    stopCleanupTimer(state)
  }
}

export async function disconnectSession(state: SkillMcpManagerState, sessionID: string): Promise<void> {
  const keysToRemove: string[] = []

  for (const [key, managed] of state.clients.entries()) {
    if (key.startsWith(`${sessionID}:`)) {
      keysToRemove.push(key)
      // Delete from map first to prevent re-entrancy during async close
      state.clients.delete(key)
      await closeManagedClient(managed)
    }
  }

  for (const key of keysToRemove) {
    state.pendingConnections.delete(key)
  }

  if (state.clients.size === 0) {
    stopCleanupTimer(state)
  }
}

export async function disconnectAll(state: SkillMcpManagerState): Promise<void> {
  stopCleanupTimer(state)
  unregisterProcessCleanup(state)

  const clients = Array.from(state.clients.values())
  state.clients.clear()
  state.pendingConnections.clear()
  state.authProviders.clear()

  for (const managed of clients) {
    await closeManagedClient(managed)
  }
}

export async function forceReconnect(state: SkillMcpManagerState, clientKey: string): Promise<boolean> {
  const existing = state.clients.get(clientKey)
  if (!existing) return false

  state.clients.delete(clientKey)
  await closeManagedClient(existing)
  return true
}
