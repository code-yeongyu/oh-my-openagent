import type { Recorder } from "./recorder"

// The process and file-system ports of a launcher-side core (slice C1b's diagnostics), over one recorder: process.spawn
// {command, argv}, process.signal {pid, signal}, fs.read / fs.list / fs.remove {path}. A recorded path names the
// scenario's home as "~" and its agent dir as "/agent", so a trace does not depend on the temp dirs a run made.

export type FakeProcessPort = {
  readonly spawn: (
    command: string,
    argv: readonly string[],
  ) => Promise<{ readonly exitCode: number; readonly stdout: string }>
  readonly signal: (pid: number, signal: string) => Promise<void>
}

export type FakeFsPort = {
  readonly read: (path: string) => Promise<string | undefined>
  readonly list: (path: string) => Promise<readonly string[]>
  readonly remove: (path: string) => Promise<void>
}

export function processPort(recorder: Recorder): FakeProcessPort {
  return {
    spawn: async (command, argv) => {
      const { result } = recorder.record("process", "spawn", { command, argv: [...argv] })
      return { exitCode: 0, stdout: "", ...(result as object | undefined) }
    },
    signal: async (pid, signal) => {
      recorder.record("process", "signal", { pid, signal })
    },
  }
}

export function fsPort(recorder: Recorder, roots: { readonly home: string; readonly agentDir: string }): FakeFsPort {
  const named = (path: string): string =>
    path.startsWith(roots.agentDir)
      ? `/agent${path.slice(roots.agentDir.length)}`
      : path.startsWith(roots.home)
        ? `~${path.slice(roots.home.length)}`
        : path
  return {
    read: async (path) => {
      const { result } = recorder.record("fs", "read", { path: named(path) })
      return typeof result === "string" ? result : undefined
    },
    list: async (path) => {
      const { result } = recorder.record("fs", "list", { path: named(path) })
      return Array.isArray(result) ? result : []
    },
    remove: async (path) => {
      recorder.record("fs", "remove", { path: named(path) })
    },
  }
}
