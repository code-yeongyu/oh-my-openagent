export type ProcessSignal = "SIGINT" | "SIGTERM" | "SIGKILL" | "SIGILL" | "SIGBREAK"

export type ProcessCleanupEvent = NodeJS.Signals | "beforeExit" | "exit"
