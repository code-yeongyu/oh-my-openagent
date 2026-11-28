import { spawn } from "node:child_process"

export const ATOMIC_OUTPUT_LIMIT_BYTES = 2 * 1024 * 1024

const ATOMIC_FORCE_KILL_GRACE_MS = 1000

export type AtomicSpawnRequest = {
  readonly executable: string
  readonly args: readonly string[]
  readonly cwd: string
  /** The complete child environment. Nothing is inherited implicitly. */
  readonly environment: Readonly<Record<string, string>>
  readonly stdin?: string
  readonly timeoutMs: number
  readonly signal?: AbortSignal
  readonly outputLimitBytes: number
}

export type AtomicOutputStream = "stdout" | "stderr"

export type AtomicSpawnOutcome =
  | { readonly kind: "exited"; readonly exitCode: number; readonly stdout: string; readonly stderr: string }
  | { readonly kind: "signaled"; readonly signal: string; readonly stdout: string; readonly stderr: string }
  | { readonly kind: "spawn_failed"; readonly errorCode: string | undefined; readonly message: string }
  | { readonly kind: "timeout" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "output_limit"; readonly stream: AtomicOutputStream }

export type AtomicSpawn = (request: AtomicSpawnRequest) => Promise<AtomicSpawnOutcome>

type Termination = Extract<AtomicSpawnOutcome, { kind: "timeout" | "cancelled" | "output_limit" }>

type StreamCollector = {
  readonly chunks: Buffer[]
  bytes: number
}

function errorCodeOf(error: Error): string | undefined {
  return "code" in error && typeof error.code === "string" ? error.code : undefined
}

/**
 * Runs one process with `shell: false`, drains stdout and stderr concurrently under a per-stream byte cap,
 * and on timeout, abort or overflow sends SIGTERM, escalates to SIGKILL after one second, and resolves only
 * after the process has closed.
 */
export const spawnAtomicProcess: AtomicSpawn = (request) => {
  if (request.signal?.aborted === true) return Promise.resolve({ kind: "cancelled" })

  return new Promise((resolve) => {
    const child = spawn(request.executable, [...request.args], {
      cwd: request.cwd,
      env: { ...request.environment },
      shell: false,
      windowsHide: true,
      stdio: [request.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    })

    let termination: Termination | undefined
    let spawnError: Error | undefined
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined

    const terminate = (reason: Termination): void => {
      if (termination !== undefined) return
      termination = reason
      child.kill("SIGTERM")
      forceKillTimer = setTimeout(() => child.kill("SIGKILL"), ATOMIC_FORCE_KILL_GRACE_MS)
    }

    const collect = (stream: AtomicOutputStream, collector: StreamCollector) => (chunk: Buffer) => {
      if (termination !== undefined) return
      collector.bytes += chunk.length
      if (collector.bytes > request.outputLimitBytes) {
        terminate({ kind: "output_limit", stream })
        return
      }
      collector.chunks.push(chunk)
    }

    const stdout: StreamCollector = { chunks: [], bytes: 0 }
    const stderr: StreamCollector = { chunks: [], bytes: 0 }
    child.stdout?.on("data", collect("stdout", stdout))
    child.stderr?.on("data", collect("stderr", stderr))

    const timeoutTimer = setTimeout(() => terminate({ kind: "timeout" }), request.timeoutMs)
    const onAbort = (): void => terminate({ kind: "cancelled" })
    request.signal?.addEventListener("abort", onAbort, { once: true })

    child.on("error", (error) => {
      spawnError = error
    })

    if (request.stdin !== undefined && child.stdin !== null) {
      // A child that exits without reading stdin closes the pipe (EPIPE); its exit status reports the real outcome.
      child.stdin.on("error", () => undefined)
      child.stdin.end(request.stdin)
    }

    child.on("close", (exitCode, signal) => {
      clearTimeout(timeoutTimer)
      if (forceKillTimer !== undefined) clearTimeout(forceKillTimer)
      request.signal?.removeEventListener("abort", onAbort)

      if (termination !== undefined) {
        resolve(termination)
        return
      }
      if (spawnError !== undefined && child.pid === undefined) {
        resolve({ kind: "spawn_failed", errorCode: errorCodeOf(spawnError), message: spawnError.message })
        return
      }
      const out = Buffer.concat(stdout.chunks).toString("utf8")
      const err = Buffer.concat(stderr.chunks).toString("utf8")
      if (exitCode !== null) {
        resolve({ kind: "exited", exitCode, stdout: out, stderr: err })
        return
      }
      resolve({ kind: "signaled", signal: signal ?? "unknown", stdout: out, stderr: err })
    })
  })
}
