import { spawn as nodeSpawn, type ChildProcess } from "node:child_process"
import { Readable } from "node:stream"
import { spawn as bunSpawn } from "./bun-spawn-shim"

export interface SpawnOptions {
  cwd?: string
  env?: Record<string, string | undefined>
  stdin?: "pipe" | "inherit" | "ignore"
  stdout?: "pipe" | "inherit" | "ignore"
  stderr?: "pipe" | "inherit" | "ignore"
}

export interface SpawnedProcess {
  readonly exitCode: number | null
  readonly exited: Promise<number>
  readonly stdout: ReadableStream<Uint8Array> | undefined
  readonly stderr: ReadableStream<Uint8Array> | undefined
  kill(signal?: NodeJS.Signals): void
}

function toReadableStream(stream: NodeJS.ReadableStream | null): ReadableStream<Uint8Array> | undefined {
  if (!stream) {
    return undefined
  }

  const readable = stream as Readable
  if (readable.destroyed || !readable.readable || Readable.isDisturbed(readable)) {
    return undefined
  }

  return Readable.toWeb(readable) as ReadableStream<Uint8Array>
}

export function wrapNodeProcess(proc: ChildProcess): SpawnedProcess {
  let resolveExited: (exitCode: number) => void
  let exitCode: number | null = null

  const exited = new Promise<number>((resolve, reject) => {
    resolveExited = resolve
    proc.on("error", (error) => {
      if (exitCode === null) {
        exitCode = 1
        reject(error)
      }
    })
  })

  proc.on("exit", (code) => {
    exitCode = code ?? 1
    resolveExited(exitCode)
  })

  return {
    get exitCode() {
      return exitCode
    },
    exited,
    stdout: toReadableStream(proc.stdout),
    stderr: toReadableStream(proc.stderr),
    kill(signal?: NodeJS.Signals): void {
      try {
        if (!signal) {
          proc.kill()
          return
        }

        proc.kill(signal)
      } catch (error) {
        if (!(error instanceof Error)) return
      }
    },
  }
}

export function spawnWithWindowsHide(command: string[], options: SpawnOptions): SpawnedProcess {
  if (process.platform !== "win32") {
    return bunSpawn(command, options)
  }

  const [cmd, ...args] = command
  if (!cmd) {
    throw new Error("Cannot spawn an empty command")
  }
  const needsShell = /\.(?:bat|cmd)$/i.test(cmd)
  const proc = nodeSpawn(cmd, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: [options.stdin ?? "ignore", options.stdout ?? "pipe", options.stderr ?? "inherit"],
    windowsHide: true,
    shell: needsShell,
  })

  return wrapNodeProcess(proc)
}
