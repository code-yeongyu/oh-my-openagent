type ManagedClientForCleanup = {
  client: {
    stop: () => Promise<void>
  }
}

type ProcessCleanupOptions = {
  getClients: () => IterableIterator<[string, ManagedClientForCleanup]>
  clearClients: () => void
  clearCleanupInterval: () => void
}

export function registerLspManagerProcessCleanup(options: ProcessCleanupOptions): void {
  // Synchronous cleanup for 'exit' event (cannot await)
  const syncCleanup = () => {
    for (const [, managed] of options.getClients()) {
      try {
        // Fire-and-forget during sync exit - process is terminating
        void managed.client.stop().catch(() => {})
      } catch {}
    }
    options.clearClients()
    options.clearCleanupInterval()
  }

  // Async cleanup for signal handlers - properly await all stops
  const asyncCleanup = async () => {
    const stopPromises: Promise<void>[] = []
    for (const [, managed] of options.getClients()) {
      stopPromises.push(managed.client.stop().catch(() => {}))
    }
    await Promise.allSettled(stopPromises)
    options.clearClients()
    options.clearCleanupInterval()
  }

  process.on("exit", syncCleanup)

  // Don't call process.exit() here; other handlers (background-agent manager) handle final exit.
  process.on("SIGINT", () => void asyncCleanup().catch(() => {}))
  process.on("SIGTERM", () => void asyncCleanup().catch(() => {}))
  if (process.platform === "win32") {
    process.on("SIGBREAK", () => void asyncCleanup().catch(() => {}))
  }
}
