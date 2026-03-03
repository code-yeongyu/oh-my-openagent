type ManagedClientForTempDirectoryCleanup = {
  refCount: number
  client: {
    stop: () => Promise<void>
  }
}

export async function cleanupTempDirectoryLspClients(
  clients: Map<string, ManagedClientForTempDirectoryCleanup>
): Promise<void> {
  const keysToRemove: string[] = []
  for (const [key, managed] of clients.entries()) {
    const isTempDir = key.startsWith("/tmp/") || key.startsWith("/var/folders/")
    const isIdle = managed.refCount === 0
    if (isTempDir && isIdle) {
      keysToRemove.push(key)
    }
  }

  for (const key of keysToRemove) {
    const managed = clients.get(key)
    if (managed) {
      clients.delete(key)
      try {
        await managed.client.stop()
      } catch {}
    }
  }
}
