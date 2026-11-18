import { spawn } from "node:child_process"

// The one spawn helper of the TUI `/remote` command (design v8-core r2 B5, guard G4b): each action runs ONE
// `omo remote ... --json` process, so the person client never enters the engine bundle.

/** `ended` is set when the process was stopped before it exited on its own: at its deadline, or by the signal. */
export type OmoRun = {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
  readonly ended?: "deadline" | "aborted"
}

export type OmoRunOptions = { readonly deadlineMs: number; readonly signal?: AbortSignal }

export type OmoRunner = (args: readonly string[], options: OmoRunOptions) => Promise<OmoRun>

export const KILL_GRACE_MS = 2_000

const STREAM_MAX_BYTES = 4 * 1024 * 1024

/**
 * Runs `<omo> <args>`: an npm launcher (`bin/omo.js`) under this runtime, a compiled omo directly, as the device
 * service bootstrap worker does. The child is stopped at its deadline or when the signal aborts, and the answer says
 * which. Rejects only when the binary cannot be started.
 */
export function omoRunner(omoBin: string, execPath: string = process.execPath): OmoRunner {
  return (args, { deadlineMs, signal }) => {
    const [command, ...argv] = omoBin.endsWith(".js") ? [execPath, omoBin, ...args] : [omoBin, ...args]
    return new Promise((resolve, reject) => {
      const child = spawn(command ?? omoBin, argv, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
      const stdout = collect(child.stdout)
      const stderr = collect(child.stderr)
      let ended: OmoRun["ended"]
      let forceKill: ReturnType<typeof setTimeout> | undefined
      // SIGTERM first so omo can close its device-service connection; a child that does not exit is killed.
      const stop = (reason: "deadline" | "aborted") => {
        ended ??= reason
        child.kill()
        forceKill ??= setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS)
      }
      const timer = setTimeout(() => stop("deadline"), deadlineMs)
      const onAbort = () => stop("aborted")
      if (signal?.aborted === true) onAbort()
      else signal?.addEventListener("abort", onAbort, { once: true })
      const settle = () => {
        clearTimeout(timer)
        clearTimeout(forceKill)
        signal?.removeEventListener("abort", onAbort)
      }
      child.once("error", (error) => {
        settle()
        reject(error)
      })
      child.once("close", (code) => {
        settle()
        resolve({ code, stdout: stdout(), stderr: stderr(), ...(ended === undefined ? {} : { ended }) })
      })
    })
  }
}

function collect(stream: NodeJS.ReadableStream): () => string {
  const chunks: Buffer[] = []
  let bytes = 0
  stream.on("data", (chunk: Buffer) => {
    if (bytes >= STREAM_MAX_BYTES) return
    bytes += chunk.length
    chunks.push(chunk)
  })
  return () => Buffer.concat(chunks).toString("utf8")
}
