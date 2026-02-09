export type ProcessCleanupEvent = NodeJS.Signals | "beforeExit" | "exit"

export function registerProcessSignal(
  signal: ProcessCleanupEvent,
  handler: () => void,
  exitAfter: boolean
): () => void {
  const listener = () => {
    handler()
    if (exitAfter) {
      // Set exitCode and schedule exit after delay to allow other handlers to complete async cleanup
      // Use 6s delay to accommodate LSP cleanup (5s timeout + 1s SIGKILL wait)
      process.exitCode = 0
      setTimeout(() => process.exit(), 6000)
    }
  }
  process.on(signal, listener)
  return listener
}
