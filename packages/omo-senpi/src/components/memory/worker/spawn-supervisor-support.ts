import { existsSync, readFileSync } from "@oh-my-opencode/memory-core/fs"
import { fileURLToPath } from "node:url"

export function definedEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined))
}

export function defaultSupervisorPath(): string {
  const override = process.env.OMO_MEMORY_RUN_SUPERVISOR_PATH
  if (override !== undefined && override.trim().length > 0) return override
  const bundled = fileURLToPath(new URL("./memory-run-supervisor.mjs", import.meta.url))
  if (existsSync(bundled)) return bundled
  return fileURLToPath(new URL("./memory-run-supervisor.ts", import.meta.url))
}

const NODE_SIGNALS = new Set<NodeJS.Signals>([
  "SIGABRT", "SIGALRM", "SIGBUS", "SIGCHLD", "SIGCONT", "SIGFPE", "SIGHUP", "SIGILL",
  "SIGINT", "SIGIO", "SIGIOT", "SIGKILL", "SIGPIPE", "SIGPOLL", "SIGPROF", "SIGPWR",
  "SIGQUIT", "SIGSEGV", "SIGSTKFLT", "SIGSTOP", "SIGSYS", "SIGTERM", "SIGTRAP", "SIGTSTP",
  "SIGTTIN", "SIGTTOU", "SIGURG", "SIGUSR1", "SIGUSR2", "SIGVTALRM", "SIGWINCH", "SIGXCPU",
  "SIGXFSZ",
])

export function isNodeSignal(signal: string | null): signal is NodeJS.Signals {
  return signal !== null && NODE_SIGNALS.has(signal as NodeJS.Signals)
}

export function readTail(path: string, maxBytes: number): string {
  try {
    const content = readFileSync(path, "utf8")
    if (Buffer.byteLength(content, "utf8") <= maxBytes) return content
    return `[truncated to last ${maxBytes} bytes]\n${content.slice(-maxBytes)}`
  } catch (error) {
    return error instanceof Error ? `[failed to read child output: ${error.message}]` : "[failed to read child output]"
  }
}
