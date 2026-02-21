type ManagedClientForCleanup = {
  client: {
    stop: () => Promise<void>;
  };
};

type ProcessCleanupOptions = {
  getClients: () => IterableIterator<[string, ManagedClientForCleanup]>;
  clearClients: () => void;
  clearCleanupInterval: () => void;
};

type RegisteredHandler = {
  event: string;
  listener: (...args: unknown[]) => void;
};

export type LspProcessCleanupHandle = {
  unregister: () => void;
};

export function registerLspManagerProcessCleanup(options: ProcessCleanupOptions): LspProcessCleanupHandle {
  const handlers: RegisteredHandler[] = [];

  // Synchronous cleanup for 'exit' event (cannot await)
  const syncCleanup = () => {
    for (const [, managed] of options.getClients()) {
      try {
        // Fire-and-forget during sync exit - process is terminating
        void managed.client.stop().catch(() => {});
      } catch {}
    }
    options.clearClients();
    options.clearCleanupInterval();
  };

  // Async cleanup for signal handlers - properly await all stops
  const asyncCleanup = async () => {
    const stopPromises: Promise<void>[] = [];
    for (const [, managed] of options.getClients()) {
      stopPromises.push(managed.client.stop().catch(() => {}));
    }
    await Promise.allSettled(stopPromises);
    options.clearClients();
    options.clearCleanupInterval();
  };

  const registerHandler = (event: string, listener: (...args: unknown[]) => void) => {
    handlers.push({ event, listener });
    process.on(event, listener);
  };

  registerHandler("exit", syncCleanup);

  // Don't call process.exit() here; other handlers (background-agent manager) handle final exit.
  const signalCleanup = () => void asyncCleanup().catch(() => {});
  registerHandler("SIGINT", signalCleanup);
  registerHandler("SIGTERM", signalCleanup);
  if (process.platform === "win32") {
    registerHandler("SIGBREAK", signalCleanup);
  }

  return {
    unregister: () => {
      for (const { event, listener } of handlers) {
        process.off(event, listener);
      }
      handlers.length = 0;
    },
  };
}
