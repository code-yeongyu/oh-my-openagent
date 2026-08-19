import { __getProcessCleanupSignalListenerForTesting } from "./process-cleanup"

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

export async function flushMicrotasks(): Promise<void> {
  for (let iteration = 0; iteration < 10; iteration += 1) {
    await Promise.resolve()
  }
}
