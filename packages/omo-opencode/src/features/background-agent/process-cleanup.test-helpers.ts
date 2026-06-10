import { __getProcessCleanupSignalListenerForTesting } from "./process-cleanup"

type ProcessCleanupEvent =
  | NodeJS.Signals
  | "beforeExit"
  | "exit"
  | "uncaughtException"
  | "unhandledRejection"

type ProcessCleanupSignal = Parameters<typeof __getProcessCleanupSignalListenerForTesting>[0]

export function getRegisteredProcessCleanupSignalListener(
  signal: ProcessCleanupSignal,
): () => void {
  const listener = __getProcessCleanupSignalListenerForTesting(signal)
  if (!listener) {
    throw new Error(`Expected this module to register a ${signal} listener`)
  }

  return listener
}

export function getNewListener(
  signal: ProcessCleanupEvent,
  existingListeners: Function[],
): () => void {
  const listener = process
    .listeners(signal)
    .find((registeredListener) => !existingListeners.includes(registeredListener))

  if (typeof listener !== "function") {
    throw new Error(`Expected a ${signal} listener to be registered`)
  }

  return listener
}

export async function flushMicrotasks(): Promise<void> {
  for (let iteration = 0; iteration < 10; iteration += 1) {
    await Promise.resolve()
  }
}
