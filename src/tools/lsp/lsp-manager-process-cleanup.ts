import { log } from "../../shared/logger"

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

  const logCleanupError = (phase: string, error: unknown): void => {
    log(`[lsp-manager-process-cleanup] ${phase}`, {
      error: error instanceof Error ? error.message : String(error),
    });
  };

  const syncCleanup = () => {
    for (const [, managed] of options.getClients()) {
      try {
        void managed.client.stop().catch((error) => {
          logCleanupError("stop failed during exit cleanup", error);
        });
      } catch (error) {
        logCleanupError("failed to schedule exit cleanup", error);
      }
    }
    options.clearClients();
    options.clearCleanupInterval();
  };

  const asyncCleanup = async () => {
    const stopPromises: Promise<void>[] = [];
    for (const [, managed] of options.getClients()) {
      stopPromises.push(managed.client.stop().catch((error) => {
        logCleanupError("stop failed during signal cleanup", error);
      }));
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

  const signalCleanup = () => void asyncCleanup().catch((error) => {
    logCleanupError("signal cleanup failed", error);
  });
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
